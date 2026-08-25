#!/bin/bash

# Configuration script to deploy dotfiles using 'stow'
# Supports: macOS, Ubuntu, Arch Linux

# --- Detect OS ---
OS="unknown"
DISTRO=""
if [[ "$OSTYPE" == "darwin"* ]]; then
    OS="mac"
elif [[ -f /etc/os-release ]]; then
    OS="linux"
    DISTRO=$(grep -oP '(?<=^ID=).+' /etc/os-release | tr -d '"')
fi

echo "--- Detected OS: $OS ${DISTRO:+($DISTRO)} ---"

# --- Install tools ---
install_tools() {
    echo "--- Installing tools ---"

    case "$OS" in
        mac)
            # Ensure Homebrew is installed
            if ! command -v brew &>/dev/null; then
                echo "Installing Homebrew..."
                /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
            fi
            brew install zsh git stow fzf tmux neovim ripgrep zoxide thefuck kitty eza
            # Install casks and extras from Brewfile
            brew bundle --file="$HOME/dotfiles/Brewfile"
            ;;
        linux)
            case "$DISTRO" in
                arch)
                    sudo pacman -S --needed --noconfirm \
                        zsh git stow fzf tmux neovim ripgrep zoxide thefuck kitty eza
                    ;;
                ubuntu|debian)
                    sudo apt update
                    sudo apt install -y \
                        zsh git stow fzf tmux neovim ripgrep kitty
                    # zoxide (not in apt)
                    curl -sSfL https://raw.githubusercontent.com/ajeetdsouza/zoxide/main/install.sh | sh
                    # eza (not in standard apt)
                    sudo apt install -y gpg
                    sudo mkdir -p /etc/apt/keyrings
                    wget -qO- https://raw.githubusercontent.com/eza-community/eza/main/deb.asc \
                        | sudo gpg --dearmor -o /etc/apt/keyrings/gierens.gpg
                    echo "deb [signed-by=/etc/apt/keyrings/gierens.gpg] http://deb.gierens.de stable main" \
                        | sudo tee /etc/apt/sources.list.d/gierens.list
                    sudo apt update && sudo apt install -y eza
                    # thefuck (via pip)
                    pip3 install thefuck --user
                    ;;
            esac
            ;;
    esac

    # --- Oh My Zsh ---
    if [[ ! -d "$HOME/.oh-my-zsh" ]]; then
        echo "Installing Oh My Zsh..."
        sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended
    fi

    # --- Powerlevel10k ---
    if [[ ! -d "${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/themes/powerlevel10k" ]]; then
        echo "Installing Powerlevel10k..."
        git clone --depth=1 https://github.com/romkatv/powerlevel10k.git \
            "${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/themes/powerlevel10k"
    fi

    # --- Zsh plugins ---
    if [[ ! -d "${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/plugins/zsh-autosuggestions" ]]; then
        git clone https://github.com/zsh-users/zsh-autosuggestions \
            "${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/plugins/zsh-autosuggestions"
    fi
    if [[ ! -d "${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/plugins/zsh-completions" ]]; then
        git clone https://github.com/zsh-users/zsh-completions \
            "${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/plugins/zsh-completions"
    fi

    echo "--- Tools installed ---"
}

# Skip tool installation with: ./configure.sh --no-install
if [[ "$1" != "--no-install" ]]; then
    install_tools
fi

# --- Define packages ---

# Packages that stow into ~/.config/<pkg>/  — available on all platforms
COMMON_CONFIG_PACKAGES="kitty nvim tmux"

# Packages that stow directly into ~/  — available on all platforms
COMMON_HOME_PACKAGES="shell zsh"

# Arch-only packages (Hyprland desktop, stow into ~/.config/)
ARCH_CONFIG_PACKAGES="hyprland hyprpaper hyprlock hyprmocha rofi swaync waybar wlogout backgrounds"

# macOS-only packages (stow into ~/.config/)
MAC_CONFIG_PACKAGES=""

# --- Build final package lists ---
CONFIG_PACKAGES="$COMMON_CONFIG_PACKAGES"
HOME_PACKAGES="$COMMON_HOME_PACKAGES"

if [[ "$OS" == "linux" && "$DISTRO" == "arch" ]]; then
    CONFIG_PACKAGES="$CONFIG_PACKAGES $ARCH_CONFIG_PACKAGES"
elif [[ "$OS" == "mac" ]]; then
    CONFIG_PACKAGES="$CONFIG_PACKAGES $MAC_CONFIG_PACKAGES"
fi

# --- Stow ---
STOW_ROOT="$HOME/dotfiles"

echo "--- Starting Dotfiles Configuration (stow) ---"
cd "$STOW_ROOT" || { echo "Error: Cannot navigate to $STOW_ROOT. Aborting."; exit 1; }

for pkg in $CONFIG_PACKAGES; do
    mv "$HOME/.config/$pkg" "$HOME/.config/$pkg.bak" 2>/dev/null
    mkdir -p "$HOME/.config/$pkg"/
done

echo "Deploying config packages: $CONFIG_PACKAGES"
stow $CONFIG_PACKAGES

echo "Deploying home packages: $HOME_PACKAGES"
stow $HOME_PACKAGES

echo "--- Configuration Complete! Symbolic links created. ---"