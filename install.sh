#!/bin/bash

source .env
source ./scripts/utils.sh

# Install applications
bash ./scripts/apps.sh

# Install cli mods
bash ./scripts/cli.sh

# Generate SSH key
if [[ $SSH_EMAIL ]]; then
  bash ./scripts/ssh.sh
fi

# Create a directory for projects and development
mkdir ${HOME}/dev

# Cleanup cached downloads and remove the installation zip and folder
info "Removing unnecessary files..."
sudo apt -y autoremove
rm -rf ../scripts.zip
rm -rf ${DOTFILES_DIR}

# Finish
success "Finished!"
