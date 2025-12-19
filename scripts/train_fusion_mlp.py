#!/usr/bin/env python3
"""
Train a fusion weight MLP to predict optimal dense/sparse/rerank weights
from query features.

Usage:
    python scripts/train_fusion_mlp.py \
        --input data/fusion_training.jsonl \
        --output models/fusion_mlp.onnx \
        --epochs 100 \
        --hidden-dim 32

The training data should be generated using:
    npx engram-benchmark train-fusion \
        -d /path/to/longmemeval \
        -o data/fusion_training.jsonl

References:
    - Neural Rank Fusion: https://www.rohan-paul.com/p/neural-based-rank-fusion-for-multi
    - PyTorch ONNX Export: https://docs.pytorch.org/docs/stable/onnx_export.html
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Optional

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, Dataset, random_split


class FusionMLP(nn.Module):
    """
    Multi-layer perceptron for predicting fusion weights from query features.

    Architecture: input_dim → hidden_dim → hidden_dim → 3 (dense, sparse, rerank)

    Input features (8 dimensions):
        - length_norm: Normalized query length
        - entity_density: Ratio of entities to tokens
        - has_temporal: Binary temporal marker presence
        - question_type: Encoded question type (0-1)
        - avg_idf_norm: Normalized average IDF
        - has_rare_terms: Binary rare term presence
        - has_specific_terms: Binary specific term presence
        - complexity: Query complexity score (0-1)

    Output: 3 weights (dense, sparse, rerank) that sum to 1 (via softmax)
    """

    def __init__(self, input_dim: int = 8, hidden_dim: int = 32, output_dim: int = 3):
        super().__init__()
        self.layers = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(hidden_dim, output_dim),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """Forward pass returning logits (softmax applied externally)."""
        return self.layers(x)


class FusionDataset(Dataset):
    """
    Dataset for fusion weight training.

    Loads JSONL training data with format:
    {
        "features": [0.5, 0.2, 1.0, 0.0, 0.3, 0, 1, 0.4],
        "optimalWeights": {"dense": 0.5, "sparse": 0.3, "rerank": 0.2}
    }
    """

    def __init__(self, data_path: str):
        self.samples: list[dict] = []

        with open(data_path) as f:
            for line in f:
                if line.strip():
                    self.samples.append(json.loads(line))

        print(f"Loaded {len(self.samples)} training samples from {data_path}")

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, torch.Tensor]:
        sample = self.samples[idx]

        # Features as input
        features = torch.tensor(sample["features"], dtype=torch.float32)

        # Optimal weights as target
        weights = sample["optimalWeights"]
        target = torch.tensor(
            [weights["dense"], weights["sparse"], weights["rerank"]], dtype=torch.float32
        )

        return features, target


def train_model(
    data_path: str,
    output_path: str,
    input_dim: int = 8,
    hidden_dim: int = 32,
    epochs: int = 100,
    batch_size: int = 32,
    learning_rate: float = 1e-3,
    val_split: float = 0.2,
    device: Optional[str] = None,
) -> dict:
    """
    Train the fusion MLP and export to ONNX.

    Args:
        data_path: Path to JSONL training data
        output_path: Path to save ONNX model
        input_dim: Input feature dimension
        hidden_dim: Hidden layer dimension
        epochs: Number of training epochs
        batch_size: Training batch size
        learning_rate: Adam learning rate
        val_split: Fraction of data for validation
        device: Device to train on (auto-detected if None)

    Returns:
        Training metrics dict
    """
    # Setup device
    if device is None:
        if torch.backends.mps.is_available():
            device = "mps"
        elif torch.cuda.is_available():
            device = "cuda"
        else:
            device = "cpu"
    print(f"Using device: {device}")

    # Load and split data
    full_dataset = FusionDataset(data_path)

    val_size = int(len(full_dataset) * val_split)
    train_size = len(full_dataset) - val_size
    train_dataset, val_dataset = random_split(
        full_dataset, [train_size, val_size], generator=torch.Generator().manual_seed(42)
    )

    print(f"Training samples: {len(train_dataset)}, Validation samples: {len(val_dataset)}")

    train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True)
    val_loader = DataLoader(val_dataset, batch_size=batch_size, shuffle=False)

    # Initialize model
    model = FusionMLP(input_dim=input_dim, hidden_dim=hidden_dim, output_dim=3)
    model = model.to(device)

    optimizer = torch.optim.Adam(model.parameters(), lr=learning_rate)

    # Use KL divergence loss since we're predicting probability distributions
    # that should sum to 1
    criterion = nn.KLDivLoss(reduction="batchmean")

    # Training loop
    best_val_loss = float("inf")
    best_model_state = None
    train_losses: list[float] = []
    val_losses: list[float] = []

    for epoch in range(epochs):
        # Training
        model.train()
        train_loss = 0.0
        for features, targets in train_loader:
            features = features.to(device)
            targets = targets.to(device)

            optimizer.zero_grad()

            # Model outputs logits, apply log_softmax for KL divergence
            outputs = model(features)
            log_probs = torch.log_softmax(outputs, dim=-1)

            # Target should already sum to 1, but normalize just in case
            targets_normed = targets / targets.sum(dim=-1, keepdim=True)

            loss = criterion(log_probs, targets_normed)
            loss.backward()
            optimizer.step()

            train_loss += loss.item()

        avg_train_loss = train_loss / len(train_loader)
        train_losses.append(avg_train_loss)

        # Validation
        model.eval()
        val_loss = 0.0
        with torch.no_grad():
            for features, targets in val_loader:
                features = features.to(device)
                targets = targets.to(device)

                outputs = model(features)
                log_probs = torch.log_softmax(outputs, dim=-1)
                targets_normed = targets / targets.sum(dim=-1, keepdim=True)

                loss = criterion(log_probs, targets_normed)
                val_loss += loss.item()

        avg_val_loss = val_loss / len(val_loader) if len(val_loader) > 0 else 0
        val_losses.append(avg_val_loss)

        # Save best model
        if avg_val_loss < best_val_loss:
            best_val_loss = avg_val_loss
            best_model_state = model.state_dict().copy()

        # Log progress
        if (epoch + 1) % 10 == 0 or epoch == 0:
            print(
                f"Epoch {epoch + 1}/{epochs} - "
                f"Train Loss: {avg_train_loss:.4f}, "
                f"Val Loss: {avg_val_loss:.4f}"
            )

    # Restore best model
    if best_model_state is not None:
        model.load_state_dict(best_model_state)
        print(f"\nRestored best model with val loss: {best_val_loss:.4f}")

    # Export to ONNX
    model.eval()
    model = model.to("cpu")
    dummy_input = torch.randn(1, input_dim)

    # Create output directory if needed
    output_dir = Path(output_path).parent
    output_dir.mkdir(parents=True, exist_ok=True)

    torch.onnx.export(
        model,
        dummy_input,
        output_path,
        export_params=True,
        opset_version=14,
        do_constant_folding=True,
        input_names=["features"],
        output_names=["weights"],
        dynamic_axes={
            "features": {0: "batch_size"},
            "weights": {0: "batch_size"},
        },
    )
    print(f"\nExported ONNX model to: {output_path}")

    # Verify ONNX model
    try:
        import onnx

        onnx_model = onnx.load(output_path)
        onnx.checker.check_model(onnx_model)
        print("ONNX model validation: PASSED")
    except ImportError:
        print("ONNX validation skipped (onnx package not installed)")
    except Exception as e:
        print(f"ONNX validation warning: {e}")

    # Test with ONNX Runtime
    try:
        import onnxruntime as ort

        session = ort.InferenceSession(output_path)
        test_input = dummy_input.numpy()
        result = session.run(None, {"features": test_input})
        weights = np.exp(result[0]) / np.sum(np.exp(result[0]))  # Softmax
        print(f"Test inference: {weights}")
    except ImportError:
        print("ONNX Runtime test skipped (onnxruntime package not installed)")
    except Exception as e:
        print(f"ONNX Runtime test warning: {e}")

    return {
        "train_losses": train_losses,
        "val_losses": val_losses,
        "best_val_loss": best_val_loss,
        "epochs": epochs,
        "output_path": output_path,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Train fusion weight MLP from grid search data"
    )
    parser.add_argument(
        "--input",
        "-i",
        required=True,
        help="Path to training data JSONL file",
    )
    parser.add_argument(
        "--output",
        "-o",
        required=True,
        help="Path to save ONNX model",
    )
    parser.add_argument(
        "--input-dim",
        type=int,
        default=8,
        help="Input feature dimension (default: 8)",
    )
    parser.add_argument(
        "--hidden-dim",
        type=int,
        default=32,
        help="Hidden layer dimension (default: 32)",
    )
    parser.add_argument(
        "--epochs",
        type=int,
        default=100,
        help="Number of training epochs (default: 100)",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=32,
        help="Training batch size (default: 32)",
    )
    parser.add_argument(
        "--learning-rate",
        type=float,
        default=1e-3,
        help="Learning rate (default: 0.001)",
    )
    parser.add_argument(
        "--val-split",
        type=float,
        default=0.2,
        help="Validation split fraction (default: 0.2)",
    )
    parser.add_argument(
        "--device",
        type=str,
        default=None,
        help="Device to train on (auto-detected if not specified)",
    )

    args = parser.parse_args()

    if not Path(args.input).exists():
        print(f"Error: Input file not found: {args.input}")
        sys.exit(1)

    metrics = train_model(
        data_path=args.input,
        output_path=args.output,
        input_dim=args.input_dim,
        hidden_dim=args.hidden_dim,
        epochs=args.epochs,
        batch_size=args.batch_size,
        learning_rate=args.learning_rate,
        val_split=args.val_split,
        device=args.device,
    )

    print("\nTraining complete!")
    print(f"Best validation loss: {metrics['best_val_loss']:.4f}")


if __name__ == "__main__":
    main()
