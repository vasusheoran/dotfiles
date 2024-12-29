sudo apt install ubuntu-gnome-desktop
sudo apt install tigervnc-standalone-server tigervnc-xorg-extension tigervnc-viewer
sudo apt-get update && sudo apt-get install gnome-shell ubuntu-gnome-desktop

sudo systemctl start gdm
sudo systemctl enable gdm

vncserver -localhost no -geometry 1024x768 -depth 24
sudo locale-gen
sudo localectl set-locale LANG="en_US.UTF-8"


cd /x/eng/rlse/app_ms/wights-dev/master/1200/ams_automation
cp -r openapi /scs/applicationmicroservices/ams_automation/
