#!/bin/bash
RELEASE=$(lsb_release -sc)
sudo sh -c "echo \"deb http://apt.postgresql.org/pub/repos/apt/ $RELEASE-pgdg main\" >> /etc/apt/sources.list.d/pgdg.list"
sudo apt update
sudo apt install -y --force-yes postgresql postgresql-contrib
cd /ias
sudo npm install pg
