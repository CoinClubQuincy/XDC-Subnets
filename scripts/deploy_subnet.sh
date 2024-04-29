#!/bin/bash

# Clone the repo
git clone https://github.com/XinFinOrg/XinFin-Node.git
cd XinFin-Node/subnet/deployment-generator/

# Create a new environment file
cp docker.env.example docker.env

# Update the env file
sed -i 's|CONFIG_PATH=.*|CONFIG_PATH=~/XinFin-Node/subnet/deployment-generator|' docker.env
sed -i 's|NETWORK_NAME=.*|NETWORK_NAME=xdcsubnet|' docker.env
sed -i 's|NUM_MACHINE=.*|NUM_MACHINE=1|' docker.env
sed -i 's|NUM_SUBNET=.*|NUM_SUBNET=3|' docker.env
sed -i 's|MAIN_IP=.*|MAIN_IP=1.11.111.111|' docker.env
sed -i 's|PARENTCHAIN=.*|PARENTCHAIN=devnet|' docker.env
sed -i 's|PARENTCHAIN_WALLET=.*|PARENTCHAIN_WALLET=YourWalletAddress|' docker.env
sed -i 's|PARENTCHAIN_WALLET_PK=.*|PARENTCHAIN_WALLET_PK=YourWalletPrivateKey|' docker.env

# Pull the latest subnet-generator image
docker pull xinfinorg/subnet-generator:latest

# Generate all the required files in the generated directory
docker run --env-file docker.env -v $(pwd)/generated:/app/generated xinfinorg/subnet-generator:latest && cd generated

# Deploy subnet on machine1
cd ~/.XinFin-Node/subnet/deployment-generator/generated
docker compose --env-file docker-compose.env --profile machine1 pull
docker compose --env-file docker-compose.env --profile machine1 up -d

# Deploy checkpoint smart contract
cd ~/.XinFin-Node/subnet/deployment-generator
docker run --env-file docker.env -v $(pwd)/generated/deployment.json:/app/generated/deployment.json --entrypoint 'bash' xinfinorg/subnet-generator:latest ./deploy_csc.sh 

# Start services and frontend
docker compose --env-file docker-compose.env --profile services pull
docker compose --env-file docker-compose.env --profile services up -d