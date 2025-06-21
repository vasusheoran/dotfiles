# Setup fzf
# ---------
if [[ ! "$PATH" == */home/gopala/.fzf/bin* ]]; then
  PATH="${PATH:+${PATH}:}/home/gopala/.fzf/bin"
fi

source <(fzf --zsh)
