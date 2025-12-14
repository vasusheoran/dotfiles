#!/bin/bash

# Configuration script to deploy dotfiles using 'stow'

PACKAGES="backgrounds hyprland hyprpaper hyprlock hyprmocha kitty nvim rofi swaync waybar wlogout"
STOW_ROOT="$HOME/dotfiles"

echo "--- Starting Dotfiles Configuration (stow) ---"
cd "$STOW_ROOT" || { echo "Error: Cannot navigate to $STOW_ROOT. Aborting."; exit 1; }

for pkg in $PACKAGES; do    
    mv "$HOME/.config/$pkg" "$HOME/.config/$pkg.bak" 2>/dev/null
    mkdir -p "$HOME/.config/$pkg"/
done

echo "Deploying packages: $PACKAGES"
stow $PACKAGES

echo "--- Configuration Complete! Symbolic links created. ---"