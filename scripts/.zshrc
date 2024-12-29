# Enable Powerlevel10k instant prompt. Should stay close to the top of ~/.zshrc.
# Initialization code that may require console input (password prompts, [y/n]
# confirmations, etc.) must go above this block; everything else may go below.
if [[ -r "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh" ]]; then
  source "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh"
fi

# If you come from bash you might have to change your $PATH.
# export PATH=$HOME/bin:/usr/local/bin:$PATH

# --------------------------- Theme ------------------------------------
# ZSH theme
ZSH_THEME="powerlevel10k/powerlevel10k"

# --------------------------- Paths ------------------------------------
# oh-my-zsh path
export ZSH=$HOME/.oh-my-zsh

# Support 256 colors path
export TERM="xterm-256color"

# --------------------------- Plugins ----------------------------------
# Which plugins would you like to load? (plugins can be found in ~/.oh-my-zsh/plugins/*)
# Custom plugins may be added to ~/.oh-my-zsh/custom/plugins/
# Example format: plugins=(rails git textmate ruby lighthouse)
# Add wisely, as too many plugins slow down shell startup.
plugins=(
  asdf
  colored-man-pages
  extract
  F-Sy-H
  zsh-autosuggestions
  zsh-completions
)

source $ZSH/oh-my-zsh.sh

# --------------------------- Aliases ----------------------------------
# Copy SSH
alias copyssh="cat < ~/.ssh/id_ed25519.pub | clip.exe | echo '=> Public SSH key copied.'"

# Open developer directory
alias dev="${HOME}/Developer"

# Open Explorer in current folder
alias explorer="explorer.exe ."

# Open .gitconfig in VSCode
alias gitcfg="code ~/.gitconfig"

# Open Windows user directory
alias winhome="/mnt/c/Users/$(echo $USER)"

# Open .zshrc in VSCode
alias zshcfg="code ~/.zshrc"

# To customize prompt, run `p10k configure` or edit ~/.p10k.zsh.
[[ ! -f ~/.p10k.zsh ]] || source ~/.p10k.zsh

# PATH
export PATH=/opt/homebrew/bin:$PATH