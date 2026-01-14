#!/bin/bash
#
# Build script for llama.cpp backends
# This script builds llama.cpp from the vendor/llama.cpp submodule
# with various backend configurations (CPU, Metal, Vulkan/MoltenVK)
#
# Usage:
#   ./scripts/build-llamacpp.sh [backend] [options]
#
# Backends:
#   macos-arm64         - macOS Apple Silicon with Metal
#   macos-metal-x64     - macOS Intel with Metal (AMD/Nvidia/Intel GPUs)
#   macos-x64           - macOS Intel (CPU only)
#   macos-vulkan-x64    - macOS Intel with Vulkan (via MoltenVK)
#   linux-x64           - Linux x64 (CPU)
#   linux-vulkan-x64    - Linux x64 with Vulkan
#   all                 - Build all backends for current platform
#
# Options:
#   --clean             - Clean build directories before building
#   --debug             - Build with debug symbols
#   --skip-moltenvk     - Skip MoltenVK download (use existing)
#
# Environment variables:
#   MOLTENVK_VERSION    - MoltenVK version to download (default: 1.4.0)
#   LLAMA_CPP_DIR       - Path to llama.cpp source (default: vendor/llama.cpp)
#   BUILD_DIR           - Build output directory (default: build/llamacpp)
#   INSTALL_DIR         - Installation directory (default: dist/llamacpp)
#

set -e

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Configuration
MOLTENVK_VERSION="${MOLTENVK_VERSION:-1.4.0}"
LLAMA_CPP_DIR="${LLAMA_CPP_DIR:-$PROJECT_ROOT/vendor/llama.cpp}"
BUILD_DIR="${BUILD_DIR:-$PROJECT_ROOT/build/llamacpp}"
INSTALL_DIR="${INSTALL_DIR:-$PROJECT_ROOT/dist/llamacpp}"
MOLTENVK_SDK_DIR="$BUILD_DIR/moltenvk-sdk"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Parse arguments
BACKEND=""
CLEAN_BUILD=false
DEBUG_BUILD=false
SKIP_MOLTENVK=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --clean)
            CLEAN_BUILD=true
            shift
            ;;
        --debug)
            DEBUG_BUILD=true
            shift
            ;;
        --skip-moltenvk)
            SKIP_MOLTENVK=true
            shift
            ;;
        -h|--help)
            head -50 "$0" | tail -n +2 | sed 's/^# \?//'
            exit 0
            ;;
        *)
            if [ -z "$BACKEND" ]; then
                BACKEND="$1"
            fi
            shift
            ;;
    esac
done

# Detect platform
detect_platform() {
    local os=$(uname -s)
    local arch=$(uname -m)
    
    case "$os" in
        Darwin)
            if [ "$arch" = "arm64" ]; then
                echo "macos-arm64"
            else
                echo "macos-x64"
            fi
            ;;
        Linux)
            if [ "$arch" = "aarch64" ]; then
                echo "linux-arm64"
            else
                echo "linux-x64"
            fi
            ;;
        *)
            log_error "Unsupported platform: $os"
            exit 1
            ;;
    esac
}

PLATFORM=$(detect_platform)

# Set build type
if [ "$DEBUG_BUILD" = true ]; then
    BUILD_TYPE="Debug"
else
    BUILD_TYPE="Release"
fi

# Download and setup MoltenVK
setup_moltenvk() {
    if [ "$SKIP_MOLTENVK" = true ] && [ -d "$MOLTENVK_SDK_DIR" ]; then
        log_info "Skipping MoltenVK download (using existing)"
        return 0
    fi
    
    local moltenvk_url="https://github.com/KhronosGroup/MoltenVK/releases/download/v${MOLTENVK_VERSION}/MoltenVK-macos.tar"
    local download_dir="$BUILD_DIR/moltenvk-download"
    local archive_path="$download_dir/MoltenVK-macos.tar"
    
    log_info "Setting up MoltenVK v${MOLTENVK_VERSION}..."
    
    # Check if already downloaded and extracted
    if [ -f "$MOLTENVK_SDK_DIR/include/MoltenVK/mvk_vulkan.h" ]; then
        log_info "MoltenVK already available at $MOLTENVK_SDK_DIR"
        return 0
    fi
    
    # Clean and create directories
    rm -rf "$download_dir" "$MOLTENVK_SDK_DIR"
    mkdir -p "$download_dir"
    
    # Download
    log_info "Downloading MoltenVK from $moltenvk_url..."
    curl -L -o "$archive_path" "$moltenvk_url"
    
    # Extract
    log_info "Extracting MoltenVK..."
    tar -xf "$archive_path" -C "$download_dir"
    
    # Find the MoltenVK root (it's nested: MoltenVK/MoltenVK/)
    local molten_root=""
    if [ -d "$download_dir/MoltenVK/MoltenVK" ]; then
        molten_root="$download_dir/MoltenVK/MoltenVK"
    elif [ -d "$download_dir/MoltenVK" ]; then
        molten_root="$download_dir/MoltenVK"
    else
        log_error "Could not find MoltenVK in extracted archive"
        exit 1
    fi
    
    # Move to SDK directory
    mv "$molten_root" "$MOLTENVK_SDK_DIR"
    
    # Verify
    if [ ! -f "$MOLTENVK_SDK_DIR/dynamic/dylib/macOS/libMoltenVK.dylib" ]; then
        log_error "MoltenVK library not found after extraction"
        exit 1
    fi
    
    # Cleanup
    rm -rf "$download_dir"
    
    log_success "MoltenVK v${MOLTENVK_VERSION} installed to $MOLTENVK_SDK_DIR"
}

# Build llama.cpp for macOS arm64 (Metal)
build_macos_arm64() {
    local backend_name="macos-arm64"
    local build_path="$BUILD_DIR/$backend_name"
    local install_path="$INSTALL_DIR/$backend_name"
    
    log_info "Building llama.cpp for macOS arm64 (Metal)..."
    
    if [ "$CLEAN_BUILD" = true ]; then
        rm -rf "$build_path"
    fi
    
    mkdir -p "$build_path"
    
    cmake -S "$LLAMA_CPP_DIR" -B "$build_path" \
        -DCMAKE_BUILD_TYPE="$BUILD_TYPE" \
        -DCMAKE_OSX_ARCHITECTURES="arm64" \
        -DCMAKE_OSX_DEPLOYMENT_TARGET="11.0" \
        -DCMAKE_INSTALL_RPATH="@loader_path" \
        -DCMAKE_BUILD_WITH_INSTALL_RPATH=ON \
        -DGGML_METAL=ON \
        -DGGML_METAL_USE_BF16=ON \
        -DGGML_METAL_EMBED_LIBRARY=ON \
        -DLLAMA_BUILD_EXAMPLES=OFF \
        -DLLAMA_BUILD_TESTS=OFF \
        -DLLAMA_BUILD_TOOLS=ON \
        -DLLAMA_BUILD_SERVER=ON
    
    cmake --build "$build_path" --config "$BUILD_TYPE" -j "$(sysctl -n hw.logicalcpu)"
    
    # Install
    mkdir -p "$install_path/build/bin"
    cp "$build_path/bin/llama-server" "$install_path/build/bin/"
    cp "$build_path/bin/llama-cli" "$install_path/build/bin/" 2>/dev/null || true
    # Bundle required dylibs for runtime
    cp "$build_path/bin/"*.dylib "$install_path/build/bin/" 2>/dev/null || true
    
    # Copy Metal library if exists
    if [ -f "$build_path/bin/ggml-metal.metallib" ]; then
        cp "$build_path/bin/ggml-metal.metallib" "$install_path/build/bin/"
    fi
    
    log_success "Built $backend_name -> $install_path"
}

# Build llama.cpp for macOS x64 (Metal)
build_macos_metal_x64() {
    local backend_name="macos-metal-x64"
    local build_path="$BUILD_DIR/$backend_name"
    local install_path="$INSTALL_DIR/$backend_name"
    
    log_info "Building llama.cpp for macOS x64 (Metal)..."
    
    if [ "$CLEAN_BUILD" = true ]; then
        rm -rf "$build_path"
    fi
    
    mkdir -p "$build_path"
    
    cmake -S "$LLAMA_CPP_DIR" -B "$build_path" \
        -DCMAKE_BUILD_TYPE="$BUILD_TYPE" \
        -DCMAKE_OSX_ARCHITECTURES="x86_64" \
        -DCMAKE_OSX_DEPLOYMENT_TARGET="11.0" \
        -DCMAKE_INSTALL_RPATH="@loader_path" \
        -DCMAKE_BUILD_WITH_INSTALL_RPATH=ON \
        -DGGML_METAL=ON \
        -DGGML_METAL_USE_BF16=ON \
        -DGGML_METAL_EMBED_LIBRARY=ON \
        -DLLAMA_BUILD_EXAMPLES=OFF \
        -DLLAMA_BUILD_TESTS=OFF \
        -DLLAMA_BUILD_TOOLS=ON \
        -DLLAMA_BUILD_SERVER=ON
    
    cmake --build "$build_path" --config "$BUILD_TYPE" -j "$(sysctl -n hw.logicalcpu)"
    
    # Install
    mkdir -p "$install_path/build/bin"
    cp "$build_path/bin/llama-server" "$install_path/build/bin/"
    cp "$build_path/bin/llama-cli" "$install_path/build/bin/" 2>/dev/null || true
    # Bundle required dylibs for runtime
    cp "$build_path/bin/"*.dylib "$install_path/build/bin/" 2>/dev/null || true
    
    # Copy Metal library if exists
    if [ -f "$build_path/bin/ggml-metal.metallib" ]; then
        cp "$build_path/bin/ggml-metal.metallib" "$install_path/build/bin/"
    fi
    
    log_success "Built $backend_name -> $install_path"
}

# Build llama.cpp for macOS x64 (CPU only)
build_macos_x64() {
    local backend_name="macos-x64"
    local build_path="$BUILD_DIR/$backend_name"
    local install_path="$INSTALL_DIR/$backend_name"
    
    log_info "Building llama.cpp for macOS x64 (CPU)..."
    
    if [ "$CLEAN_BUILD" = true ]; then
        rm -rf "$build_path"
    fi
    
    mkdir -p "$build_path"
    
    cmake -S "$LLAMA_CPP_DIR" -B "$build_path" \
        -DCMAKE_BUILD_TYPE="$BUILD_TYPE" \
        -DCMAKE_OSX_ARCHITECTURES="x86_64" \
        -DCMAKE_OSX_DEPLOYMENT_TARGET="11.0" \
        -DCMAKE_INSTALL_RPATH="@loader_path" \
        -DCMAKE_BUILD_WITH_INSTALL_RPATH=ON \
        -DGGML_METAL=OFF \
        -DLLAMA_BUILD_EXAMPLES=OFF \
        -DLLAMA_BUILD_TESTS=OFF \
        -DLLAMA_BUILD_TOOLS=ON \
        -DLLAMA_BUILD_SERVER=ON
    
    cmake --build "$build_path" --config "$BUILD_TYPE" -j "$(sysctl -n hw.logicalcpu)"
    
    # Install
    mkdir -p "$install_path/build/bin"
    cp "$build_path/bin/llama-server" "$install_path/build/bin/"
    cp "$build_path/bin/llama-cli" "$install_path/build/bin/" 2>/dev/null || true
    
    log_success "Built $backend_name -> $install_path"
}

# Build llama.cpp for macOS x64 with Vulkan (via MoltenVK)
build_macos_vulkan_x64() {
    local backend_name="macos-vulkan-x64"
    local build_path="$BUILD_DIR/$backend_name"
    local install_path="$INSTALL_DIR/$backend_name"
    
    log_info "Building llama.cpp for macOS x64 (Vulkan/MoltenVK)..."
    
    # Setup MoltenVK first
    setup_moltenvk
    
    # Verify MoltenVK paths
    local vulkan_include="$MOLTENVK_SDK_DIR/include"
    local vulkan_library="$MOLTENVK_SDK_DIR/dynamic/dylib/macOS/libMoltenVK.dylib"
    
    if [ ! -f "$vulkan_library" ]; then
        log_error "MoltenVK library not found at $vulkan_library"
        exit 1
    fi
    
    if [ "$CLEAN_BUILD" = true ]; then
        rm -rf "$build_path"
    fi
    
    mkdir -p "$build_path"
    
    # Set Vulkan SDK environment
    export VULKAN_SDK="$MOLTENVK_SDK_DIR"
    
    cmake -S "$LLAMA_CPP_DIR" -B "$build_path" \
        -DCMAKE_BUILD_TYPE="$BUILD_TYPE" \
        -DCMAKE_OSX_ARCHITECTURES="x86_64" \
        -DCMAKE_OSX_DEPLOYMENT_TARGET="11.3" \
        -DCMAKE_INSTALL_RPATH="@loader_path" \
        -DCMAKE_BUILD_WITH_INSTALL_RPATH=ON \
        -DGGML_METAL=OFF \
        -DGGML_VULKAN=ON \
        -DVulkan_INCLUDE_DIR="$vulkan_include" \
        -DVulkan_LIBRARY="$vulkan_library" \
        -DLLAMA_BUILD_EXAMPLES=OFF \
        -DLLAMA_BUILD_TESTS=OFF \
        -DLLAMA_BUILD_TOOLS=ON \
        -DLLAMA_BUILD_SERVER=ON
    
    cmake --build "$build_path" --config "$BUILD_TYPE" -j "$(sysctl -n hw.logicalcpu)"
    
    # Install
    mkdir -p "$install_path/build/bin"
    cp "$build_path/bin/llama-server" "$install_path/build/bin/"
    cp "$build_path/bin/llama-cli" "$install_path/build/bin/" 2>/dev/null || true
    
    # Copy MoltenVK library - IMPORTANT: this must be bundled with the backend
    cp "$vulkan_library" "$install_path/build/bin/"
    
    # Copy any Vulkan-related dylibs from the build
    cp "$build_path/bin/"*.dylib "$install_path/build/bin/" 2>/dev/null || true
    
    # Also copy MoltenVK to Tauri resources for bundling in the .app
    # This allows the hardware detection plugin to find it at runtime
    local tauri_frameworks_dir="$SCRIPT_DIR/../src-tauri/resources/frameworks"
    mkdir -p "$tauri_frameworks_dir"
    cp "$vulkan_library" "$tauri_frameworks_dir/"
    log_info "Copied MoltenVK to $tauri_frameworks_dir for app bundling"
    
    log_success "Built $backend_name -> $install_path"
}

# Build llama.cpp for Linux x64 (CPU)
build_linux_x64() {
    local backend_name="linux-x64"
    local build_path="$BUILD_DIR/$backend_name"
    local install_path="$INSTALL_DIR/$backend_name"
    
    log_info "Building llama.cpp for Linux x64 (CPU)..."
    
    if [ "$CLEAN_BUILD" = true ]; then
        rm -rf "$build_path"
    fi
    
    mkdir -p "$build_path"
    
    cmake -S "$LLAMA_CPP_DIR" -B "$build_path" \
        -DCMAKE_BUILD_TYPE="$BUILD_TYPE" \
        -DCMAKE_INSTALL_RPATH='$ORIGIN' \
        -DCMAKE_BUILD_WITH_INSTALL_RPATH=ON \
        -DGGML_NATIVE=OFF \
        -DLLAMA_BUILD_EXAMPLES=OFF \
        -DLLAMA_BUILD_TESTS=OFF \
        -DLLAMA_BUILD_TOOLS=ON \
        -DLLAMA_BUILD_SERVER=ON
    
    cmake --build "$build_path" --config "$BUILD_TYPE" -j "$(nproc)"
    
    # Install
    mkdir -p "$install_path/build/bin"
    cp "$build_path/bin/llama-server" "$install_path/build/bin/"
    cp "$build_path/bin/llama-cli" "$install_path/build/bin/" 2>/dev/null || true
    
    log_success "Built $backend_name -> $install_path"
}

# Build llama.cpp for Linux x64 with Vulkan
build_linux_vulkan_x64() {
    local backend_name="linux-vulkan-x64"
    local build_path="$BUILD_DIR/$backend_name"
    local install_path="$INSTALL_DIR/$backend_name"
    
    log_info "Building llama.cpp for Linux x64 (Vulkan)..."
    
    # Check for Vulkan SDK
    if [ -z "$VULKAN_SDK" ] && ! command -v vulkaninfo &> /dev/null; then
        log_warn "Vulkan SDK not found. Install vulkan-sdk package or set VULKAN_SDK"
    fi
    
    if [ "$CLEAN_BUILD" = true ]; then
        rm -rf "$build_path"
    fi
    
    mkdir -p "$build_path"
    
    cmake -S "$LLAMA_CPP_DIR" -B "$build_path" \
        -DCMAKE_BUILD_TYPE="$BUILD_TYPE" \
        -DCMAKE_INSTALL_RPATH='$ORIGIN' \
        -DCMAKE_BUILD_WITH_INSTALL_RPATH=ON \
        -DGGML_NATIVE=OFF \
        -DGGML_VULKAN=ON \
        -DLLAMA_BUILD_EXAMPLES=OFF \
        -DLLAMA_BUILD_TESTS=OFF \
        -DLLAMA_BUILD_TOOLS=ON \
        -DLLAMA_BUILD_SERVER=ON
    
    cmake --build "$build_path" --config "$BUILD_TYPE" -j "$(nproc)"
    
    # Install
    mkdir -p "$install_path/build/bin"
    cp "$build_path/bin/llama-server" "$install_path/build/bin/"
    cp "$build_path/bin/llama-cli" "$install_path/build/bin/" 2>/dev/null || true
    cp "$build_path/bin/"*.so "$install_path/build/bin/" 2>/dev/null || true
    
    log_success "Built $backend_name -> $install_path"
}

# Package backend as tar.gz (matching janhq/llama.cpp release format)
package_backend() {
    local backend_name="$1"
    local install_path="$INSTALL_DIR/$backend_name"
    local version=$(cd "$LLAMA_CPP_DIR" && git describe --tags --always 2>/dev/null || echo "local")
    local package_name="llama-${version}-bin-${backend_name}.tar.gz"
    local package_path="$INSTALL_DIR/$package_name"
    
    if [ ! -d "$install_path" ]; then
        log_error "Backend not found at $install_path"
        return 1
    fi
    
    log_info "Packaging $backend_name as $package_name..."
    
    # Create tarball matching the expected structure
    tar -czvf "$package_path" -C "$install_path" .
    
    log_success "Created package: $package_path"
}

# Main entry point
main() {
    log_info "Jan llama.cpp Build Script"
    log_info "Platform: $PLATFORM"
    log_info "Build type: $BUILD_TYPE"
    
    # Verify submodule
    if [ ! -f "$LLAMA_CPP_DIR/CMakeLists.txt" ]; then
        log_error "llama.cpp submodule not found at $LLAMA_CPP_DIR"
        log_info "Run: git submodule update --init --recursive"
        exit 1
    fi
    
    # Create directories
    mkdir -p "$BUILD_DIR" "$INSTALL_DIR"
    
    # Build requested backend(s)
    case "$BACKEND" in
        macos-arm64)
            build_macos_arm64
            package_backend "macos-arm64"
            ;;
        macos-x64)
            build_macos_x64
            package_backend "macos-x64"
            ;;
        macos-metal-x64)
            build_macos_metal_x64
            package_backend "macos-metal-x64"
            ;;
        macos-vulkan-x64)
            build_macos_vulkan_x64
            package_backend "macos-vulkan-x64"
            ;;
        linux-x64)
            build_linux_x64
            package_backend "linux-x64"
            ;;
        linux-vulkan-x64)
            build_linux_vulkan_x64
            package_backend "linux-vulkan-x64"
            ;;
        all)
            case "$PLATFORM" in
                macos-arm64)
                    build_macos_arm64
                    package_backend "macos-arm64"
                    ;;
                macos-x64)
                    # On Intel Mac, build GPU backends (Metal + Vulkan)
                    build_macos_metal_x64
                    package_backend "macos-metal-x64"
                    build_macos_vulkan_x64
                    package_backend "macos-vulkan-x64"
                    ;;
                linux-x64)
                    build_linux_x64
                    package_backend "linux-x64"
                    build_linux_vulkan_x64
                    package_backend "linux-vulkan-x64"
                    ;;
                *)
                    log_error "Unknown platform for 'all' build: $PLATFORM"
                    exit 1
                    ;;
            esac
            ;;
        "")
            # Default: build for current platform
            case "$PLATFORM" in
                macos-arm64)
                    build_macos_arm64
                    package_backend "macos-arm64"
                    ;;
                macos-x64)
                    # On Intel Mac, build GPU backends (Metal + Vulkan)
                    build_macos_metal_x64
                    package_backend "macos-metal-x64"
                    build_macos_vulkan_x64
                    package_backend "macos-vulkan-x64"
                    ;;
                linux-x64)
                    build_linux_x64
                    package_backend "linux-x64"
                    ;;
                *)
                    log_error "Unknown platform: $PLATFORM"
                    exit 1
                    ;;
            esac
            ;;
        *)
            log_error "Unknown backend: $BACKEND"
            echo "Available backends: macos-arm64, macos-metal-x64, macos-vulkan-x64, linux-x64, linux-vulkan-x64, all"
            exit 1
            ;;
    esac
    
    log_success "Build complete!"
    log_info "Backends available in: $INSTALL_DIR"
}

main
