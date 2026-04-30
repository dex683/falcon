import matplotlib.pyplot as plt

# Main rows (classes + blank line)
rows_main = [
    ["no_damage",   "0.62", "0.67", "0.65", "15"],
    ["low",         "0.73", "0.77", "0.75", "35"],
    ["medium",      "0.58", "0.39", "0.47", "18"],
    ["high",        "0.81", "1.00", "0.90", "13"],
    ["severe",      "0.62", "0.62", "0.62", "8"],
]

# Footer rows (summary)
rows_footer = [
    ["accuracy",    "",     "",     "0.70", "89"],
    ["macro avg",   "0.68", "0.69", "0.68", "89"],
    ["weighted avg","0.69", "0.70", "0.69", "89"]
    ]
plt.rcParams["font.family"] = "serif"
fig, ax = plt.subplots(figsize=(12, 8))
ax.axis("off")

# Title
ax.text(0.5, 0.96, "Final Validation Report", ha="center", va="top",
        fontsize=20, fontweight="bold")

# — Table 1: Main classification table
table1 = ax.table(
    cellText=rows_main,
    colLabels=["Class", "Precision", "Recall", "F1-Score", "Support"],
    cellLoc="center",
    colLoc="center",
    bbox=[0.03, 0.45, 0.94, 0.40],   # top table: lower bbox
)
table1.auto_set_font_size(False)
table1.set_fontsize(12)

for (r, c), cell in table1.get_celld().items():
    cell.set_edgecolor("#333333")
    if r == 0:
        cell.set_facecolor("#eaeaea")
        cell.set_text_props(weight="bold")

# — Table 2: Summary stats (bottom table)
table2 = ax.table(
    cellText=rows_footer,
    cellLoc="center",
    colLoc="center",
    bbox=[0.03, 0.15, 0.94, 0.20],   # smaller, lower bbox
)
table2.auto_set_font_size(False)
table2.set_fontsize(12)

for (r, c), cell in table2.get_celld().items():
    cell.set_edgecolor("#333333")
    cell.set_facecolor("#f8f8f8")
    # if r == 0:
    #     cell.set_text_props(weight="bold")

# Optional: add a small “Stats” title above the second table
ax.text(0.5, 0.36, "Summary", ha="center", va="bottom",
        fontsize=14, fontweight="bold")

# Times‑like serif (if available)
plt.rcParams["font.family"] = "serif"
try:
    plt.rcParams["font.serif"] = ["DejaVu Serif", "Times New Roman", "Liberation Serif"]
except:
    pass

# plt.savefig("final_validation_report.png", dpi=300, bbox_inches="tight")
plt.savefig("final_validation_report.jpg", dpi=300, bbox_inches="tight")
print("Saved final_validation_report.png and final_validation_report.jpg")