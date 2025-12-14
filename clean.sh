#!/bin/bash

# Cleanup script to remove deployed dotfiles and restore backups

PACKAGES="backgrounds hyprland kitty nvim rofi swaync waybar wlogout"
STOW_ROOT="$HOME/dotfiles"

echo "--- Starting Dotfiles Cleanup (Destow) ---"

cd "$STOW_ROOT" || { echo "Error: Cannot navigate to $STOW_ROOT. Aborting."; exit 1; }

echo "Removing symbolic links for packages: $PACKAGES"
stow -D $PACKAGES

for pkg in $PACKAGES; do
    BACKUP_PATH="$pkg.bak"
    if [ -d "$BACKUP_PATH" ]; then
        echo "Restoring backup for $pkg..."
        rmdir "$pkg" 2>/dev/null        
        mv "$BACKUP_PATH" "$pkg"
    fi
done

echo "--- Cleanup Complete! Symbolic links removed. ---"