#!/bin/bash

sudo yum update -y
sudo yum install docker -y
sudo systemctl start docker
# sudo docker run hello-world
sudo systemctl enable docker

# Docker Compose
sudo curl -L https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m) -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
docker-compose version

# Optional
sudo usermod -a -G docker $(whoami)
# Activate changes without logging out => newgrp docker