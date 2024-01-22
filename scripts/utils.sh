#!/bin/bash
#
# Some functions used in install scripts

source .env

# Global variables
DOTFILES_DIR="$PWD"

# Info message
info() {
  printf "\n$(tput setaf 3)%s$(tput sgr0)\n" "$@"
  sleep 2
}

# Success message
success() {
  printf "\n$(tput setaf 2)✓ %s$(tput sgr0)\n" "$@"
  sleep 2
}

# Warning message
warning() {
  printf "\n$(tput setaf 136)! %s$(tput sgr0)\n" "$@"
  sleep 2
}

# Force move/replace files
replace() {
  cp -f "${DOTFILES_DIR}/${1}" "${HOME}/${2}"
}
