"""
Disaster Damage Classifier — Training Script
Fine-tunes MobileNetV2 on 201 hand-labelled drone images.
Classes: no_damage, low, medium, high, severe
"""

import os
import sys
import json
import csv
import time
import random
from pathlib import Path
from collections import Counter
import gc

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
from torchvision import models, transforms
from PIL import Image
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, confusion_matrix, roc_curve, auc
import numpy as np
import matplotlib.pyplot as plt
from sklearn.preprocessing import label_binarize

# ── Config ──────────────────────────────────────────────────────────────────
CSV_PATH   = Path(__file__).parent.parent /'ml' /'labeler' / 'exports' / '20260328_164122' / 'labels.csv'
MODEL_DIR  = Path(__file__).parent
MODEL_PATH = MODEL_DIR / 'damage_classifier.pth'
CLASS_PATH = MODEL_DIR / 'class_names.json'

CLASS_ORDER = ['no_damage', 'low', 'medium', 'high', 'severe']
IMG_SIZE    = 224
BATCH_SIZE  = 8
EPOCHS      = 20
LR          = 1e-4
SEED        = 42
MAX_PIX     = 1024

random.seed(SEED)
torch.manual_seed(SEED)

# ── Dataset ──────────────────────────────────────────────────────────────────
class DamageDataset(Dataset):
    def __init__(self, samples, class_to_idx, transform=None):
        self.samples = samples
        self.class_to_idx = class_to_idx
        self.transform = transform

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        fpath, label_str = self.samples[idx]
        img = Image.open(fpath).convert('RGB')
        if max(img.size) > MAX_PIX:
            img.thumbnail((MAX_PIX, MAX_PIX), Image.LANCZOS)
        if self.transform:
            img = self.transform(img)
        return img, self.class_to_idx[label_str]


def load_csv(csv_path):
    samples = []
    with open(csv_path, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            fp = row['filepath'].strip()
            label = row['label'].strip()
            if os.path.isfile(fp) and label in CLASS_ORDER:
                samples.append((fp, label))
            else:
                print(f'  [SKIP] {fp} — file missing or unknown label "{label}"')
    return samples

# ── Transforms ───────────────────────────────────────────────────────────────
train_tf = transforms.Compose([
    transforms.Resize((IMG_SIZE, IMG_SIZE)),
    transforms.RandomHorizontalFlip(),
    transforms.RandomRotation(15),
    transforms.ColorJitter(brightness=0.2, contrast=0.2),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
])

val_tf = transforms.Compose([
    transforms.Resize((IMG_SIZE, IMG_SIZE)),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
])

# ── Model ────────────────────────────────────────────────────────────────────
def build_model(num_classes):
    model = models.mobilenet_v2(weights=models.MobileNet_V2_Weights.IMAGENET1K_V1)
    for param in model.features.parameters():
        param.requires_grad = False
    for layer in model.features[-3:]:
        for param in layer.parameters():
            param.requires_grad = True
    in_features = model.classifier[1].in_features
    model.classifier = nn.Sequential(
        nn.Dropout(0.4),
        nn.Linear(in_features, 256),
        nn.ReLU(),
        nn.Dropout(0.3),
        nn.Linear(256, num_classes),
    )
    return model

# ── Training Loop ────────────────────────────────────────────────────────────
def train():
    print('=' * 60)
    print('  Disaster Damage Classifier - Training')
    print('=' * 60)

    print(f'[1/5] Loading CSV from {CSV_PATH}')
    samples = load_csv(CSV_PATH)
    print(f'      Loaded {len(samples)} valid samples')

    label_counts = Counter(lbl for _, lbl in samples)
    print('      Class distribution:')
    for cls in CLASS_ORDER:
        print(f'        {cls:12s}: {label_counts.get(cls, 0):3d}')

    class_to_idx = {c: i for i, c in enumerate(CLASS_ORDER)}
    idx_to_class = {i: c for c, i in class_to_idx.items()}

    labels_only = [lbl for _, lbl in samples]
    train_s, val_s = train_test_split(samples, test_size=0.2, random_state=SEED, stratify=labels_only)
    print(f'[2/5] Split: {len(train_s)} train / {len(val_s)} val')

    train_ds = DamageDataset(train_s, class_to_idx, transform=train_tf)
    val_ds = DamageDataset(val_s, class_to_idx, transform=val_tf)
    train_dl = DataLoader(train_ds, batch_size=BATCH_SIZE, shuffle=True, num_workers=0)
    val_dl = DataLoader(val_ds, batch_size=BATCH_SIZE, shuffle=False, num_workers=0)

    counts = [label_counts.get(c, 1) for c in CLASS_ORDER]
    total = sum(counts)
    weights = torch.tensor([total / (len(CLASS_ORDER) * c) for c in counts], dtype=torch.float)

    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f'[3/5] Building MobileNetV2 on {device}')
    model = build_model(len(CLASS_ORDER)).to(device)
    weights = weights.to(device)

    criterion = nn.CrossEntropyLoss(weight=weights)
    optimizer = optim.AdamW(filter(lambda p: p.requires_grad, model.parameters()), lr=LR, weight_decay=1e-4)
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=EPOCHS)

    print(f'[4/5] Training for {EPOCHS} epochs ...')
    best_val_acc = 0.0

    for epoch in range(1, EPOCHS + 1):
        t0 = time.time()
        model.train()
        train_loss, train_correct, train_total = 0.0, 0, 0
        for imgs, lbls in train_dl:
            imgs, lbls = imgs.to(device), lbls.to(device)
            optimizer.zero_grad()
            out = model(imgs)
            loss = criterion(out, lbls)
            loss.backward()
            optimizer.step()
            train_loss += loss.item() * imgs.size(0)
            preds = out.argmax(dim=1)
            train_correct += (preds == lbls).sum().item()
            train_total += imgs.size(0)

        model.eval()
        val_loss, val_correct, val_total = 0.0, 0, 0
        with torch.no_grad():
            for imgs, lbls in val_dl:
                imgs, lbls = imgs.to(device), lbls.to(device)
                out = model(imgs)
                loss = criterion(out, lbls)
                val_loss += loss.item() * imgs.size(0)
                preds = out.argmax(dim=1)
                val_correct += (preds == lbls).sum().item()
                val_total += imgs.size(0)

        scheduler.step()
        gc.collect()

        t_loss = train_loss / train_total
        t_acc = train_correct / train_total * 100
        v_loss = val_loss / val_total
        v_acc = val_correct / val_total * 100
        elapsed = time.time() - t0

        star = ' * BEST' if v_acc > best_val_acc else ''
        print(f'  Epoch {epoch:3d}/{EPOCHS}  train loss={t_loss:.4f} acc={t_acc:.1f}%  |  val loss={v_loss:.4f} acc={v_acc:.1f}%  ({elapsed:.1f}s){star}')

        if v_acc > best_val_acc:
            best_val_acc = v_acc
            torch.save({
                'model_state_dict': model.state_dict(),
                'class_names': CLASS_ORDER,
                'class_to_idx': class_to_idx,
                'img_size': IMG_SIZE,
            }, MODEL_PATH)

    print(f'[5/5] Best val accuracy: {best_val_acc:.1f}%  - model already saved on best epoch')
    with open(CLASS_PATH, 'w') as f:
        json.dump({'class_names': CLASS_ORDER, 'class_to_idx': class_to_idx}, f, indent=2)

    print(f'      Model saved -> {MODEL_PATH}')
    print(f'      Labels saved -> {CLASS_PATH}')

    print('-- Final Validation Report --')
    ckpt = torch.load(MODEL_PATH, map_location=device)
    model.load_state_dict(ckpt['model_state_dict'])
    model.to(device).eval()

    all_preds, all_true, all_probs = [], [], []
    with torch.no_grad():
        for imgs, lbls in val_dl:
            imgs = imgs.to(device)
            logits = model(imgs)
            probs = torch.softmax(logits, dim=1)
            preds = probs.argmax(dim=1)
            all_preds.extend(preds.cpu().tolist())
            all_true.extend(lbls.tolist())
            all_probs.extend(probs.cpu().tolist())

    all_preds_names = [idx_to_class[i] for i in all_preds]
    all_true_names = [idx_to_class[i] for i in all_true]
    print(classification_report(all_true_names, all_preds_names, target_names=CLASS_ORDER))

    print('-- Confusion Matrix (rows=true, cols=pred) --')
    cm = confusion_matrix(all_true_names, all_preds_names, labels=CLASS_ORDER)
    header = ''.join(f'{c:>12s}' for c in CLASS_ORDER)
    print(f'{"":12s}{header}')
    for i, row in enumerate(cm):
        print(f'{CLASS_ORDER[i]:12s}' + ''.join(f'{v:12d}' for v in row))

    y_true = np.array(all_true)
    y_score = np.array(all_probs)
    y_bin = label_binarize(y_true, classes=list(range(len(CLASS_ORDER))))

    plt.figure(figsize=(8, 6))
    for i, cls_name in enumerate(CLASS_ORDER):
        fpr, tpr, _ = roc_curve(y_bin[:, i], y_score[:, i])
        roc_auc = auc(fpr, tpr)
        plt.plot(fpr, tpr, lw=2, label=f'{cls_name} (AUC = {roc_auc:.2f})')

    plt.plot([0, 1], [0, 1], 'k--', lw=1)
    plt.xlim([0.0, 1.0])
    plt.ylim([0.0, 1.05])
    plt.xlabel('False Positive Rate')
    plt.ylabel('True Positive Rate')
    plt.title('Multiclass ROC Curve')
    plt.legend(loc='lower right')
    plt.tight_layout()
    roc_path = MODEL_DIR / 'roc_curve.png'
    plt.savefig(roc_path, dpi=300, bbox_inches='tight')
    plt.close()
    print(f'ROC saved -> {roc_path}')

    print('[DONE] Training complete!')

if __name__ == '__main__':
    train()
