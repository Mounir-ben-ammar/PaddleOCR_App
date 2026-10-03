import json
import os
import tempfile

# Corporate networks that intercept HTTPS: trust the OS certificate store, and fetch
# models from Hugging Face since Paddle's own hosts are often blocked.
import truststore

truststore.inject_into_ssl()
os.environ.setdefault("PADDLE_PDX_MODEL_SOURCE", "huggingface")

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request
from openai import OpenAI
from paddleocr import PaddleOCR

load_dotenv()

MODEL = os.getenv("OPENAI_MODEL", "gpt-4o")
SYSTEM_PROMPT = (
    "Tu extrais les opérations d'un document financier (relevé bancaire, reçu, facture) "
    "à partir de texte OCR dont l'alignement horizontal des colonnes est conservé. "
    "Pour chaque opération, renvoie : date_operation, nature_operation, montant_debit, montant_credit. "
    "Utilise la position d'un montant sous les en-têtes Débit / Crédit pour le classer. "
    "Un paiement ou un achat (ex. un reçu) est un débit. "
    "Recopie les dates et montants tels qu'ils apparaissent ; mets null pour un montant absent. "
    "Ignore les soldes et totaux de colonnes. "
    "Réponds uniquement en JSON valide, sans explication : "
    '{"operations": [{"date_operation": "...", "nature_operation": "...", '
    '"montant_debit": "...", "montant_credit": null}]}'
)

app = Flask(__name__)
client = OpenAI()  # reads OPENAI_API_KEY from the environment
ocr = PaddleOCR(
    lang=os.getenv("OCR_LANG", "en"),
    use_doc_orientation_classify=False,
    use_doc_unwarping=False,  # distorts flat scans and clips text at the page edge
    use_textline_orientation=False,
    enable_mkldnn=False,  # oneDNN crashes on Windows with paddlepaddle 3.3
)


def layout_text(boxes, texts) -> str:
    """Rebuild lines and keep horizontal alignment, so the LLM can tell which column an amount is in."""
    items = [
        (float(b[0]), float(b[1]), float(b[2]), float(b[3]), t)
        for b, t in zip(boxes, texts)
        if t and t.strip()
    ]
    if not items:
        return ""
    heights = sorted(y2 - y1 for _, y1, _, y2, _ in items)
    row_tol = heights[len(heights) // 2] * 0.5
    char_widths = sorted((x2 - x1) / len(t) for x1, _, x2, _, t in items)
    char_w = max(char_widths[len(char_widths) // 2], 1.0)

    rows = []
    for item in sorted(items, key=lambda i: (i[1] + i[3]) / 2):
        yc = (item[1] + item[3]) / 2
        if rows and abs(yc - (rows[-1][0][1] + rows[-1][0][3]) / 2) <= row_tol:
            rows[-1].append(item)
        else:
            rows.append([item])

    lines = []
    for row in rows:
        line = ""
        for x1, _, _, _, text in sorted(row, key=lambda i: i[0]):
            col = int(x1 / char_w)
            line += " " * max(col - len(line), 1 if line else 0) + text
        lines.append(line)
    return "\n".join(lines)


def extract_text(path: str) -> str:
    """Step 1: run PaddleOCR on an image or PDF (one result per page)."""
    pages = [layout_text(res["rec_boxes"], res["rec_texts"]) for res in ocr.predict(path)]
    if len(pages) == 1:
        return pages[0]
    return "\n\n".join(f"--- Page {i} ---\n{text}" for i, text in enumerate(pages, 1))


def extract_operations(ocr_text: str) -> list[dict]:
    """Step 2: ask GPT for the operations table."""
    response = client.chat.completions.create(
        model=MODEL,
        temperature=0,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": ocr_text},
        ],
    )
    raw = response.choices[0].message.content.strip()
    if raw.startswith("```"):
        raw = raw.strip("`").removeprefix("json").strip()
    return json.loads(raw)["operations"]


@app.get("/")
def index():
    return render_template("index.html")


@app.post("/process")
def process():
    file = request.files.get("image")
    if not file or not file.filename:
        return jsonify(error="No file uploaded"), 400

    suffix = os.path.splitext(file.filename)[1] or ".png"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        path = tmp.name
    # Saved after closing: Windows can't reopen a file that's still open.
    file.save(path)
    try:
        ocr_text = extract_text(path)
    finally:
        os.remove(path)

    if not ocr_text.strip():
        return jsonify(ocr_text="", operations=[], error="No text detected in the image")

    try:
        operations = extract_operations(ocr_text)
    except (json.JSONDecodeError, KeyError, TypeError) as e:
        return jsonify(ocr_text=ocr_text, operations=[], error=f"Unreadable LLM answer: {e}"), 502
    except Exception as e:
        return jsonify(ocr_text=ocr_text, operations=[], error=f"LLM error: {e}"), 502

    return jsonify(ocr_text=ocr_text, operations=operations)


if __name__ == "__main__":
    app.run(debug=True, use_reloader=False)
