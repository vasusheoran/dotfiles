#!/bin/env bash
echo " CMD > sudo apt update"
sudo apt update

echo;

echo " CMD > sudo apt-get install gnome-panel gnome-settings-daemon metacity nautilus gnome-terminal"
sudo apt-get install gnome-panel gnome-settings-daemon metacity nautilus gnome-terminal
# sudo apt install gnome-panel
# gnome-panel &

echo;

echo " CMD > sudo apt install tightvncserver"
sudo apt install tightvncserver

echo;

echo " CMD > vncserver"
echo;

echo " CMD > ***** Choose no for view only password *********"
vncserver

echo;

echo " CMD > vncserver -kill :1"
vncserver -kill :1

echo;

echo " CMD > mv ~/.vnc/xstartup ~/.vnc/xstartup.bak"
mv ~/.vnc/xstartup ~/.vnc/xstartup.bak

echo;

echo " CMD > cat ~/.vnc/xstartup"
cat << EOT >> ~/.vnc/xstartup
#!/bin/sh

export XKL_XMODMAP_DISABLE=1
unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS

[ -x /etc/vnc/xstartup ] && exec /etc/vnc/xstartup
[ -r $HOME/.Xresources ] && xrdb $HOME/.Xresources
xsetroot -solid grey
vncconfig -iconic &

gnome-panel &
gnome-settings-daemon &
metacity &
nautilus &
gnome-terminal &
EOT

echo;

echo " CMD > sudo chmod +x ~/.vnc/xstartup"
sudo chmod +x ~/.vnc/xstartup

# vncserver

# Running vnc as system service
echo;

echo " CMD > cat vncserver@.service"
user=$(whoami)
cat << EOT >>  template_vncserver@.service

[Unit]
Description=Start TightVNC server at startup
After=syslog.target network.target

[Service]
Type=forking
User=$user
Group=$user
WorkingDirectory=/home/$user

PIDFile=/home/$user/.vnc/%H:%i.pid
ExecStartPre=-/usr/bin/vncserver -kill :%i > /dev/null 2>&1
ExecStart=/usr/bin/vncserver -depth 24 -geometry 1600x900 :%i
ExecStop=/usr/bin/vncserver -kill :%i

[Install]
WantedBy=multi-user.target
EOT


echo;

echo " CMD > mv template_vncserver@.service /etc/systemd/system/vncserver@.service"
sudo bash -c 'mv template_vncserver@.service /etc/systemd/system/vncserver@.service'

echo;

echo " CMD > sudo systemctl daemon-reload"
sudo systemctl daemon-reload

echo;

echo " CMD > sudo systemctl enable vncserver@1.service"
sudo systemctl enable vncserver@1.service


echo;

echo " CMD > sudo systemctl start vncserver@1"
sudo systemctl start vncserver@1
# sudo systemctl stop vncserver@1

echo;

echo " CMD > sudo systemctl status vncserver@1 | grep Active"
sudo systemctl status vncserver@1 | grep Active

