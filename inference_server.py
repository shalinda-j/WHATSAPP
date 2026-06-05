"""
FastAPI Inference Server for WhatsApp Bot NLP Model
Serves the trained model from autoresearch experiments on port 8001
"""

import os
import json
import time
from pathlib import Path
from typing import Optional, List
from datetime import datetime

import torch
import torch.nn as nn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Configuration
MODEL_PATH = Path(os.environ.get("MODEL_PATH", "ai-research/best_model.pt"))
TOKENIZER_PATH = Path(os.environ.get(
    "TOKENIZER_PATH",
    str(Path.home() / ".cache" / "autoresearch" / "tokenizer")
))
DEFAULT_MODEL_DIM = 128
DEFAULT_VOCAB_SIZE = 10000
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# Intent labels for WhatsApp Bot
INTENT_LABELS = [
    "booking",
    "lead_register",
    "greeting",
    "help",
    "query",
    "command",
    "unknown"
]

# Language detection patterns
LANGUAGE_PATTERNS = {
    "sinhala": set("ශ්රීංකකමදයරතනපියවහළස්"),
    "tamil": set("தமிழ்நாடுகங்களரொபழெய"),
    "english": set("abcdefghijklmnopqrstuvwxyz")
}


# Request/Response Models
class PredictRequest(BaseModel):
    text: str
    return_confidence: bool = True


class PredictResponse(BaseModel):
    intent: str
    confidence: float
    language: Optional[str] = None
    inference_time_ms: float


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    model_path: Optional[str]
    model_size_mb: Optional[float]
    device: str
    last_reload: Optional[str]


class ReloadResponse(BaseModel):
    status: str
    message: str
    timestamp: str


# Simple Intent Classification Model
class IntentClassifier(nn.Module):
    """Lightweight intent classification model for WhatsApp messages"""

    def __init__(self, vocab_size: int = DEFAULT_VOCAB_SIZE, embed_dim: int = 128,
                 hidden_dim: int = 256, num_classes: int = 7):
        super().__init__()
        self.embedding = nn.Embedding(vocab_size, embed_dim)
        self.conv1 = nn.Conv1d(embed_dim, hidden_dim, kernel_size=3, padding=1)
        self.conv2 = nn.Conv1d(hidden_dim, hidden_dim, kernel_size=3, padding=1)
        self.pool = nn.AdaptiveMaxPool1d(1)
        self.dropout = nn.Dropout(0.3)
        self.fc = nn.Linear(hidden_dim, num_classes)
        self.relu = nn.ReLU()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (batch, seq_len)
        x = self.embedding(x)  # (batch, seq_len, embed_dim)
        x = x.transpose(1, 2)  # (batch, embed_dim, seq_len)
        x = self.relu(self.conv1(x))
        x = self.relu(self.conv2(x))
        x = self.pool(x).squeeze(-1)  # (batch, hidden_dim)
        x = self.dropout(x)
        x = self.fc(x)
        return x


# Simple Tokenizer
class SimpleTokenizer:
    """Simple character + word tokenizer for multilingual text"""

    def __init__(self, vocab_size: int = DEFAULT_VOCAB_SIZE):
        self.vocab_size = vocab_size
        self.char_to_idx = {}
        self.idx_to_char = {}
        self.pad_token = 0
        self.unk_token = 1

    def fit(self, texts: List[str]):
        """Build vocabulary from texts"""
        chars = set()
        for text in texts:
            chars.update(text.lower())

        for i, char in enumerate(sorted(chars)[:self.vocab_size - 2]):
            self.char_to_idx[char] = i + 2
            self.idx_to_char[i + 2] = char

    def encode(self, text: str, max_length: int = 100) -> List[int]:
        """Encode text to token ids"""
        tokens = []
        for char in text.lower()[:max_length]:
            tokens.append(self.char_to_idx.get(char, self.unk_token))
        return tokens

    def __call__(self, text: str, max_length: int = 100) -> torch.Tensor:
        """Tokenize and pad text"""
        tokens = self.encode(text, max_length)
        tokens = tokens + [self.pad_token] * (max_length - len(tokens))
        return torch.tensor(tokens[:max_length])


# FastAPI App
app = FastAPI(
    title="WhatsApp Bot NLP Inference Server",
    description="Serves intent classification model for WhatsApp messages",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global state
model: Optional[IntentClassifier] = None
tokenizer: Optional[SimpleTokenizer] = None
model_load_time: Optional[datetime] = None


def detect_language(text: str) -> str:
    """Detect language from character patterns"""
    chars = set(text.lower())
    scores = {}

    for lang, pattern in LANGUAGE_PATTERNS.items():
        overlap = len(chars & pattern)
        scores[lang] = overlap

    best_lang = max(scores, key=scores.get)
    return best_lang if scores[best_lang] > 0 else "unknown"


def load_model() -> bool:
    """Load or initialize the model"""
    global model, tokenizer, model_load_time

    try:
        tokenizer = SimpleTokenizer()

        if MODEL_PATH.exists():
            # Load trained model
            checkpoint = torch.load(MODEL_PATH, map_location=DEVICE)

            # Extract model config
            if isinstance(checkpoint, dict):
                state_dict = checkpoint.get('model', checkpoint)
                vocab_size = checkpoint.get('vocab_size', DEFAULT_VOCAB_SIZE)
                embed_dim = checkpoint.get('embed_dim', DEFAULT_MODEL_DIM)
            else:
                state_dict = checkpoint
                vocab_size = DEFAULT_VOCAB_SIZE
                embed_dim = DEFAULT_MODEL_DIM

            model = IntentClassifier(vocab_size=vocab_size, embed_dim=embed_dim)
            model.load_state_dict(state_dict, strict=False)
            model.to(DEVICE)
            model.eval()

            print(f"✅ Loaded model from {MODEL_PATH}")
        else:
            # Initialize new model for training
            model = IntentClassifier()
            model.to(DEVICE)
            model.eval()
            print(f"⚠️ No trained model found, using uninitialized model")

        model_load_time = datetime.now()
        return True

    except Exception as e:
        print(f"❌ Error loading model: {e}")
        # Fallback to uninitialized model
        model = IntentClassifier()
        model.to(DEVICE)
        model.eval()
        model_load_time = datetime.now()
        return False


@app.on_event("startup")
async def startup_event():
    """Load model on startup"""
    load_model()


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Check server and model status"""
    model_size_mb = None
    if MODEL_PATH.exists():
        model_size_mb = MODEL_PATH.stat().st_size / (1024 * 1024)

    return HealthResponse(
        status="healthy",
        model_loaded=model is not None,
        model_path=str(MODEL_PATH) if MODEL_PATH.exists() else None,
        model_size_mb=round(model_size_mb, 2) if model_size_mb else None,
        device=DEVICE,
        last_reload=model_load_time.isoformat() if model_load_time else None
    )


@app.post("/predict", response_model=PredictResponse)
async def predict(request: PredictRequest):
    """Predict intent for a message"""
    if model is None or tokenizer is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    start_time = time.time()

    try:
        # Tokenize input
        tokens = tokenizer(request.text, max_length=100).unsqueeze(0).to(DEVICE)

        # Run inference
        with torch.no_grad():
            logits = model(tokens)
            probs = torch.softmax(logits, dim=-1)
            confidence, predicted = torch.max(probs, dim=-1)

        intent_idx = predicted.item()
        intent = INTENT_LABELS[intent_idx] if intent_idx < len(INTENT_LABELS) else "unknown"

        # Detect language
        language = detect_language(request.text)

        inference_time = (time.time() - start_time) * 1000  # ms

        return PredictResponse(
            intent=intent,
            confidence=round(confidence.item(), 4),
            language=language,
            inference_time_ms=round(inference_time, 2)
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Inference error: {str(e)}")


@app.post("/reload", response_model=ReloadResponse)
async def reload_model():
    """Reload model from disk (call after training)"""
    success = load_model()

    if success:
        return ReloadResponse(
            status="success",
            message="Model reloaded successfully",
            timestamp=datetime.now().isoformat()
        )
    else:
        return ReloadResponse(
            status="warning",
            message="Model reload had issues, using fallback",
            timestamp=datetime.now().isoformat()
        )


@app.get("/intents")
async def list_intents():
    """List available intent labels"""
    return {"intents": INTENT_LABELS}


@app.post("/batch_predict")
async def batch_predict(texts: List[str]):
    """Batch predict intents for multiple messages"""
    if model is None or tokenizer is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    results = []
    start_time = time.time()

    try:
        # Tokenize all texts
        tokens_list = [tokenizer(text, max_length=100) for text in texts]
        tokens_batch = torch.stack(tokens_list).to(DEVICE)

        # Batch inference
        with torch.no_grad():
            logits = model(tokens_batch)
            probs = torch.softmax(logits, dim=-1)
            confidences, predictions = torch.max(probs, dim=-1)

        for i, text in enumerate(texts):
            intent_idx = predictions[i].item()
            results.append({
                "text": text,
                "intent": INTENT_LABELS[intent_idx] if intent_idx < len(INTENT_LABELS) else "unknown",
                "confidence": round(confidences[i].item(), 4),
                "language": detect_language(text)
            })

        total_time = (time.time() - start_time) * 1000

        return {
            "results": results,
            "total_inference_time_ms": round(total_time, 2),
            "avg_inference_time_ms": round(total_time / len(texts), 2)
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Batch inference error: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    PORT = int(os.environ.get('INFERENCE_PORT', '8001'))
    uvicorn.run(app, host="0.0.0.0", port=PORT)