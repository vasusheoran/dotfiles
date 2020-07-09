# Setup fzf
# ---------
if [[ ! "$PATH" == */home/vasu/.fzf/bin* ]]; then
  export PATH="${PATH:+${PATH}:}/home/vasu/.fzf/bin"
fi

# Auto-completion
# ---------------
[[ $- == *i* ]] && source "/home/vasu/.fzf/shell/completion.zsh" 2> /dev/null

# Key bindings
# ------------
source "/home/vasu/.fzf/shell/key-bindings.zsh"
