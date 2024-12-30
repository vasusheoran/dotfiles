echo -e "F\nn\np\n\n\n185542271\nv\np\nt\n3\n8e\np\nw" | fdisk /dev/sda
#echo -e "F\np\n\nv\np\nt\n2\nL\nw" | fdisk $new_disk
pvscan
pvcreate /dev/sda3
partprobe
vgdisplay
vgextend centos /dev/sda3
pvscan
lvdisplay
lvextend /dev/centos/root /dev/sda3
xfs_growfs /dev/mapper/centos-root
