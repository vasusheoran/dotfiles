 ## dotfiles

 # Use command below to intialize default config
 sh -c "$(curl -fsSL https://raw.githubusercontent.com/vasusheoran/dotfiles/master/setup.sh)"

 # Set default user 
Invoke-Expression $(Invoke-WebRequest  https://raw.githubusercontent.com/vasusheoran/dotfiles/master/SetWSL-User.ps1)