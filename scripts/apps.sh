#!/bin/bash

source ./scripts/utils.sh

# Update Ubuntu
sudo apt update && sudo apt upgrade -y

# Ubuntu WSL
# sudo apt install -y ubuntu-wsl

# Essential package
sudo apt install -y build-essential

# Common packages
sudo apt install -y apt-transport-https ca-certificates curl gawk ssh-askpass tree unzip wget zsh

# Git
sudo add-apt-repository -y ppa:git-core/ppa
sudo apt update && sudo apt install -y git

# Finish
success "Finished applications installation."
