import os
import json
import csv
import shutil
from datetime import datetime
from flask import Flask, render_template, request, jsonify, send_from_directory, redirect, url_for, session

app = Flask(__name__)
app.secret_key = 'disaster_labeler_secret_key_2024'

# ── Config ──────────────────────────────────────────────────────────────────
SUPPORTED_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.bmp', '.gif', '.tiff', '.webp'}
LABELS = ['no_damage', 'low', 'medium', 'high', 'severe']
LABEL_COLORS = {
    'no_damage': '#64748b',
    'low':       '#22c55e',
    'medium':    '#f59e0b',
    'high':      '#f97316',
    'severe':    '#ef4444',
}

# Persistent state stored in a JSON file inside the labeler folder
STATE_FILE = os.path.join(os.path.dirname(__file__), 'state.json')


# ── Helpers ──────────────────────────────────────────────────────────────────
def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE, 'r') as f:
            return json.load(f)
    return {'folder': '', 'labels': {}, 'session_start': None}


def save_state(state):
    with open(STATE_FILE, 'w') as f:
        json.dump(state, f, indent=2)


def get_images(folder):
    if not folder or not os.path.isdir(folder):
        return []
    files = []
    for fname in sorted(os.listdir(folder)):
        if os.path.splitext(fname)[1].lower() in SUPPORTED_EXTENSIONS:
            files.append(fname)
    return files


def get_stats(labels_dict, images):
    total = len(images)
    labeled = len(labels_dict)
    unlabeled = total - labeled
    counts = {lbl: 0 for lbl in LABELS}
    for lbl in labels_dict.values():
        if lbl in counts:
            counts[lbl] += 1
    return {
        'total': total,
        'labeled': labeled,
        'unlabeled': unlabeled,
        'percent': round((labeled / total * 100) if total else 0, 1),
        'counts': counts,
    }


# ── Routes ───────────────────────────────────────────────────────────────────
@app.route('/')
def index():
    state = load_state()
    folder = state.get('folder', '')
    images = get_images(folder)
    stats = get_stats(state.get('labels', {}), images)
    return render_template('index.html',
                           folder=folder,
                           images=images,
                           labels=state.get('labels', {}),
                           stats=stats,
                           label_colors=LABEL_COLORS,
                           label_list=LABELS)


@app.route('/set_folder', methods=['POST'])
def set_folder():
    folder = request.form.get('folder', '').strip()
    if not os.path.isdir(folder):
        return jsonify({'success': False, 'error': f'Folder not found: {folder}'}), 400
    state = load_state()
    if state.get('folder') != folder:
        # New folder — reset labels
        state['folder'] = folder
        state['labels'] = {}
        state['session_start'] = datetime.now().isoformat()
    save_state(state)
    return jsonify({'success': True, 'folder': folder})


@app.route('/label/<path:filename>', methods=['POST'])
def label_image(filename):
    label = request.json.get('label')
    if label not in LABELS:
        return jsonify({'success': False, 'error': 'Invalid label'}), 400
    state = load_state()
    folder = state.get('folder', '')
    filepath = os.path.join(folder, filename)
    if not os.path.isfile(filepath):
        return jsonify({'success': False, 'error': 'Image not found'}), 404
    state['labels'][filename] = label
    save_state(state)
    images = get_images(folder)
    stats = get_stats(state['labels'], images)
    return jsonify({'success': True, 'stats': stats})


@app.route('/unlabel/<path:filename>', methods=['POST'])
def unlabel_image(filename):
    state = load_state()
    state['labels'].pop(filename, None)
    save_state(state)
    images = get_images(state.get('folder', ''))
    stats = get_stats(state['labels'], images)
    return jsonify({'success': True, 'stats': stats})


@app.route('/image/<path:filename>')
def serve_image(filename):
    state = load_state()
    folder = state.get('folder', '')
    return send_from_directory(folder, filename)


@app.route('/export', methods=['POST'])
def export_dataset():
    export_format = request.json.get('format', 'csv')  # csv | folders | json
    state = load_state()
    folder = state.get('folder', '')
    labels_dict = state.get('labels', {})

    if not folder or not labels_dict:
        return jsonify({'success': False, 'error': 'Nothing to export'}), 400

    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    export_dir = os.path.join(os.path.dirname(__file__), 'exports', ts)
    os.makedirs(export_dir, exist_ok=True)

    if export_format == 'csv':
        csv_path = os.path.join(export_dir, 'labels.csv')
        with open(csv_path, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(['filename', 'filepath', 'label'])
            for fname, lbl in sorted(labels_dict.items()):
                writer.writerow([fname, os.path.join(folder, fname), lbl])
        return jsonify({'success': True, 'path': csv_path, 'count': len(labels_dict)})

    elif export_format == 'folders':
        # Copy images into label sub-folders
        for lbl in LABELS:
            os.makedirs(os.path.join(export_dir, lbl), exist_ok=True)
        copied = 0
        for fname, lbl in labels_dict.items():
            src = os.path.join(folder, fname)
            dst = os.path.join(export_dir, lbl, fname)
            if os.path.isfile(src):
                shutil.copy2(src, dst)
                copied += 1
        # Also write a CSV alongside
        csv_path = os.path.join(export_dir, 'labels.csv')
        with open(csv_path, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(['filename', 'filepath', 'label'])
            for fname, lbl in sorted(labels_dict.items()):
                writer.writerow([fname, os.path.join(export_dir, lbl, fname), lbl])
        return jsonify({'success': True, 'path': export_dir, 'count': copied})

    elif export_format == 'json':
        data = {
            'metadata': {
                'source_folder': folder,
                'exported_at': datetime.now().isoformat(),
                'total_labeled': len(labels_dict),
                'label_counts': {lbl: sum(1 for v in labels_dict.values() if v == lbl) for lbl in LABELS},
            },
            'annotations': [
                {'filename': fname, 'filepath': os.path.join(folder, fname), 'label': lbl}
                for fname, lbl in sorted(labels_dict.items())
            ]
        }
        json_path = os.path.join(export_dir, 'dataset.json')
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
        return jsonify({'success': True, 'path': json_path, 'count': len(labels_dict)})

    return jsonify({'success': False, 'error': 'Unknown format'}), 400


@app.route('/api/state')
def api_state():
    state = load_state()
    images = get_images(state.get('folder', ''))
    stats = get_stats(state.get('labels', {}), images)
    return jsonify({'images': images, 'labels': state.get('labels', {}), 'stats': stats, 'folder': state.get('folder', '')})


@app.route('/reset', methods=['POST'])
def reset():
    state = load_state()
    state['labels'] = {}
    save_state(state)
    return jsonify({'success': True})


if __name__ == '__main__':
    app.run(debug=True, port=5050)
