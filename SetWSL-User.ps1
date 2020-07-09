Function WSL-SetDefaultUser ($distro="Ubuntu", $user="vasu") 
{
    echo "Setting User : $user, distro : $distro" 
    Get-ItemProperty Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Lxss\*\ DistributionName | Where-Object -Property DistributionName -eq $distro | Set-ItemProperty -Name DefaultUid -Value ((wsl -d $distro -u $user -e id -u) | Out-String); 
};

Function GetUserID ($distro="Ubuntu", $user="vasu")
{
    echo "Setting User : $user, distro : $distro" 

    $val=Invoke-Expression "wsl -d $distro -u $user -e id -u"
    echo $val

};

WSL-SetDefaultUser -distro Ubuntu -user vasu;
#GetUserID -distro Ubuntu -user vasu;