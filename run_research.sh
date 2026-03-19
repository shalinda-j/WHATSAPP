#!/bin/bash
# Autoresearch Overnight Automation Script
# Runs 100 experiments for WhatsApp Bot NLP optimization
# Estimated runtime: 8-9 hours (5 min per experiment + overhead)

set -e

# Configuration
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
AI_RESEARCH_DIR="$PROJECT_ROOT/ai-research"
LOGS_DIR="$PROJECT_ROOT/logs"
MAX_EXPERIMENTS=100
EXPERIMENT_COUNT=0

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Create logs directory
mkdir -p "$LOGS_DIR"

# Log file
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
MAIN_LOG="$LOGS_DIR/research_$TIMESTAMP.log"

echo "================================================" | tee -a "$MAIN_LOG"
echo "  AUTORESEARCH OVERNIGHT AUTOMATION" | tee -a "$MAIN_LOG"
echo "  Started: $(date)" | tee -a "$MAIN_LOG"
echo "  Max experiments: $MAX_EXPERIMENTS" | tee -a "$MAIN_LOG"
echo "================================================" | tee -a "$MAIN_LOG"
echo ""

# Check if uv is available
if ! command -v uv &> /dev/null; then
    echo -e "${RED}Error: uv is not installed${NC}" | tee -a "$MAIN_LOG"
    echo "Please install uv: curl -LsSf https://astral.sh/uv/install.sh | sh" | tee -a "$MAIN_LOG"
    exit 1
fi

# Check if ai-research directory exists
if [ ! -d "$AI_RESEARCH_DIR" ]; then
    echo -e "${RED}Error: ai-research directory not found${NC}" | tee -a "$MAIN_LOG"
    echo "Please clone autoresearch: git clone https://github.com/karpathy/autoresearch.git ai-research" | tee -a "$MAIN_LOG"
    exit 1
fi

# Change to ai-research directory
cd "$AI_RESEARCH_DIR"

# Check if virtual environment exists
if [ ! -d ".venv" ]; then
    echo -e "${YELLOW}Virtual environment not found. Running uv sync...${NC}" | tee -a "$MAIN_LOG"
    uv sync | tee -a "$MAIN_LOG"
fi

# Ensure results.tsv exists
if [ ! -f "results.tsv" ]; then
    echo -e "${YELLOW}Creating results.tsv...${NC}" | tee -a "$MAIN_LOG"
    echo -e "commit\tval_bpb\tmemory_gb\tstatus\tdescription" > results.tsv
fi

# Check if we're on an autoresearch branch
BRANCH=$(git branch --show-current)
if [[ ! "$BRANCH" =~ ^autoresearch/ ]]; then
    echo -e "${YELLOW}Not on autoresearch branch. Creating new branch...${NC}" | tee -a "$MAIN_LOG"
    TAG=$(date +"%b%d" | tr '[:upper:]' '[:lower:]')
    git checkout -b "autoresearch/$TAG" 2>/dev/null || git checkout "autoresearch/$TAG"
    echo -e "${GREEN}Switched to branch: $(git branch --show-current)${NC}" | tee -a "$MAIN_LOG"
fi

# Function to run a single experiment
run_experiment() {
    local exp_num=$1
    local exp_log="$LOGS_DIR/experiment_${exp_num}_$TIMESTAMP.log"

    echo "" | tee -a "$MAIN_LOG"
    echo -e "${BLUE}========================================${NC}" | tee -a "$MAIN_LOG"
    echo -e "${BLUE}  EXPERIMENT #$exp_num${NC}" | tee -a "$MAIN_LOG"
    echo -e "${BLUE}  Time: $(date)${NC}" | tee -a "$MAIN_LOG"
    echo -e "${BLUE}========================================${NC}" | tee -a "$MAIN_LOG"

    # Run training
    echo -e "${YELLOW}Running training...${NC}" | tee -a "$MAIN_LOG"
    if uv run train.py > "$exp_log" 2>&1; then
        # Extract metrics
        VAL_BPB=$(grep "^val_bpb:" "$exp_log" | awk '{print $2}' || echo "0.000000")
        PEAK_VRAM=$(grep "^peak_vram_mb:" "$exp_log" | awk '{print $2}' || echo "0.0")
        MEMORY_GB=$(echo "scale=1; $PEAK_VRAM / 1024" | bc)

        # Get current commit hash
        COMMIT=$(git rev-parse --short HEAD)

        echo -e "${GREEN}✅ Experiment completed${NC}" | tee -a "$MAIN_LOG"
        echo "   val_bpb: $VAL_BPB" | tee -a "$MAIN_LOG"
        echo "   memory: ${MEMORY_GB}GB" | tee -a "$MAIN_LOG"

        # Log to results.tsv
        echo -e "$COMMIT\t$VAL_BPB\t$MEMORY_GB\tkeep\tautoresearch experiment $exp_num" >> results.tsv

        # Reload inference server with new model
        if [ -f "best_model.pt" ]; then
            echo -e "${YELLOW}Reloading inference server...${NC}" | tee -a "$MAIN_LOG"
            curl -s -X POST http://localhost:8001/reload > /dev/null 2>&1 || true
        fi
    else
        # Experiment failed
        COMMIT=$(git rev-parse --short HEAD)
        echo -e "${RED}❌ Experiment crashed${NC}" | tee -a "$MAIN_LOG"
        tail -n 20 "$exp_log" | tee -a "$MAIN_LOG"

        # Log crash to results.tsv
        echo -e "$COMMIT\t0.000000\t0.0\tcrash\texperiment $exp_num crashed" >> results.tsv

        # Reset to last good commit
        git reset --hard HEAD~1 2>/dev/null || true
    fi
}

# Main experiment loop
echo -e "${GREEN}Starting experiment loop...${NC}" | tee -a "$MAIN_LOG"
echo "Press Ctrl+C to stop" | tee -a "$MAIN_LOG"
echo ""

while [ $EXPERIMENT_COUNT -lt $MAX_EXPERIMENTS ]; do
    EXPERIMENT_COUNT=$((EXPERIMENT_COUNT + 1))
    run_experiment $EXPERIMENT_COUNT

    # Check if best_model.pt exists and is improving
    if [ -f "best_model.pt" ]; then
        SIZE=$(stat -f%z "best_model.pt" 2>/dev/null || stat -c%s "best_model.pt" 2>/dev/null || echo "0")
        echo -e "${GREEN}Best model size: $SIZE bytes${NC}" | tee -a "$MAIN_LOG"
    fi

    # Sleep briefly between experiments
    sleep 5
done

# Summary
echo "" | tee -a "$MAIN_LOG"
echo "================================================" | tee -a "$MAIN_LOG"
echo "  AUTORESEARCH COMPLETE" | tee -a "$MAIN_LOG"
echo "  Completed: $(date)" | tee -a "$MAIN_LOG"
echo "  Total experiments: $EXPERIMENT_COUNT" | tee -a "$MAIN_LOG"
echo "================================================" | tee -a "$MAIN_LOG"
echo "" | tee -a "$MAIN_LOG"

# Show best results
echo -e "${GREEN}Top 5 Best Results:${NC}" | tee -a "$MAIN_LOG"
tail -n +2 results.tsv | sort -t$'\t' -k2 -n | head -n 5 | tee -a "$MAIN_LOG"

echo "" | tee -a "$MAIN_LOG"
echo -e "${YELLOW}Results saved to: results.tsv${NC}" | tee -a "$MAIN_LOG"
echo -e "${YELLOW}Logs saved to: $LOGS_DIR${NC}" | tee -a "$MAIN_LOG"