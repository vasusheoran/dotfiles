#!/bin/bash

source ./scripts/utils.sh

# Install home brew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

brew tap homebrew/cask-fonts                     # You only need to do this once!
brew search nerd-font                            # Search for font packages

# Install nerd fonts
brew install --cask font-jetbrains-mono-nerd-font

brew install ripgrep

brew install tmux

brew install fzf

# To install useful keybindings and fuzzy completion:
#   /opt/homebrew/opt/fzf/install

# To use fzf in Vim, add the following line to your .vimrc:
#   set rtp+=/opt/homebrew/opt/fzf

# Finish
success "Finished applications installation."
