 # dotfiles

 ### Create User
 sh -c "$(curl -fsSL https://raw.githubusercontent.com/vasusheoran/dotfiles/master/create-user.sh)"

 ### Set up default configurations
 sh -c "$(curl -fsSL https://raw.githubusercontent.com/vasusheoran/dotfiles/master/install)"

 ### Set default user 
Invoke-Expression $(Invoke-WebRequest  https://raw.githubusercontent.com/vasusheoran/dotfiles/master/SetWSL-User.ps1)
