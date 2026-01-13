#!/bin/bash
#
# Install locally-built llama.cpp backends to Jan's data folder
#
# This script copies built backends from dist/llamacpp/<backend>/
# to ~/jan/llamacpp/backends/<version>/<backend>/
#
# Usage:
#   ./scripts/install-llamacpp-backend.sh [backend]
#
# Examples:
#   ./scripts/install-llamacpp-backend.sh                    # Install all built backends
#   ./scripts/install-llamacpp-backend.sh macos-vulkan-x64   # Install specific backend
#

set -e

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Configuration
LLAMA_CPP_DIR="${LLAMA_CPP_DIR:-$PROJECT_ROOT/vendor/llama.cpp}"
DIST_DIR="${DIST_DIR:-$PROJECT_ROOT/dist/llamacpp}"
JAN_DATA_DIR="${JAN_DATA_DIR:-$HOME/jan}"
JAN_BACKENDS_DIR="$JAN_DATA_DIR/llamacpp/backends"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Get version from llama.cpp submodule
get_version() {
    if [ -d "$LLAMA_CPP_DIR" ]; then
        cd "$LLAMA_CPP_DIR"
        local version=$(git describe --tags --always 2>/dev/null || echo "local")
        cd "$PROJECT_ROOT"
        echo "$version"
    else
        echo "local"
    fi
}

# Install a single backend
install_backend() {
    local backend_name="$1"
    local src_dir="$DIST_DIR/$backend_name"
    local version=$(get_version)
    local dest_dir="$JAN_BACKENDS_DIR/$version/$backend_name"
    
    if [ ! -d "$src_dir" ]; then
        log_error "Backend not found: $src_dir"
        log_info "Run 'make build-llamacpp-$backend_name' first"
        return 1
    fi
    
    # Check if llama-server exists
    local server_path="$src_dir/build/bin/llama-server"
    if [ ! -f "$server_path" ]; then
        log_error "llama-server not found in $src_dir"
        return 1
    fi
    
    log_info "Installing $backend_name (version: $version)..."
    log_info "  Source: $src_dir"
    log_info "  Destination: $dest_dir"
    
    # Create destination directory
    mkdir -p "$dest_dir"
    
    # Copy the backend files
    cp -r "$src_dir"/* "$dest_dir/"
    
    # Ensure llama-server is executable
    chmod +x "$dest_dir/build/bin/llama-server"
    
    # For Vulkan backends, ensure MoltenVK is properly set up
    if [[ "$backend_name" == *"vulkan"* ]]; then
        local moltenvk_lib="$dest_dir/build/bin/libMoltenVK.dylib"
        if [ -f "$moltenvk_lib" ]; then
            log_info "  MoltenVK library found"
            # Ensure the dylib is code-signed for macOS (ad-hoc signing)
            if [[ "$(uname -s)" == "Darwin" ]]; then
                codesign -f -s - "$moltenvk_lib" 2>/dev/null || true
            fi
        else
            log_warn "  MoltenVK library not found - Vulkan backend may not work"
        fi
    fi
    
    log_success "Installed $backend_name to $dest_dir"
}

# Main
main() {
    local target_backend="$1"
    
    log_info "Jan llama.cpp Backend Installer"
    log_info "Jan data folder: $JAN_DATA_DIR"
    
    # Ensure Jan data directory exists
    mkdir -p "$JAN_BACKENDS_DIR"
    
    # Check if dist directory exists
    if [ ! -d "$DIST_DIR" ]; then
        log_error "No built backends found at $DIST_DIR"
        log_info "Run 'make build-llamacpp' first"
        exit 1
    fi
    
    # Get list of available backends
    local backends=()
    for dir in "$DIST_DIR"/*/; do
        if [ -d "$dir" ]; then
            local name=$(basename "$dir")
            # Skip if it's a tar.gz file directory or not a valid backend
            if [ -f "$dir/build/bin/llama-server" ] || [ -f "$dir/build/bin/llama-server.exe" ]; then
                backends+=("$name")
            fi
        fi
    done
    
    if [ ${#backends[@]} -eq 0 ]; then
        log_error "No built backends found in $DIST_DIR"
        exit 1
    fi
    
    log_info "Available backends: ${backends[*]}"
    
    # Install specific or all backends
    if [ -n "$target_backend" ]; then
        # Install specific backend
        if [[ ! " ${backends[*]} " =~ " ${target_backend} " ]]; then
            log_error "Backend '$target_backend' not found in built backends"
            log_info "Available: ${backends[*]}"
            exit 1
        fi
        install_backend "$target_backend"
    else
        # Install all backends
        for backend in "${backends[@]}"; do
            install_backend "$backend"
        done
    fi
    
    log_success "Installation complete!"
    log_info "Backends are now available in Jan at: $JAN_BACKENDS_DIR"
}

main "$@"
