#!/bin/bash
#./deploy_subnet.sh YourWalletAddress YourWalletPrivateKey

# Check if wallet address and private key are passed as arguments
if [ "$#" -ne 2 ]; then
    echo "Usage: $0 YourWalletAddress YourWalletPrivateKey"
    exit 1
fi

WALLET_ADDRESS=$1
WALLET_PRIVATE_KEY=$2

# Clone the repo
if [ ! -d "XinFin-Node" ]; then
    git clone https://github.com/XinFinOrg/XinFin-Node.git
    echo "Downloading XinFin-Node..."
fi
cd XinFin-Node/subnet/deployment-generator/
echo "Cloned XinFin-Node"

# Create a new environment file
cp script/docker.env.example docker.env
echo "Created docker.env"

# Update the env file
sed -i '' 's|CONFIG_PATH=.*|CONFIG_PATH=~/XinFin-Node/subnet/deployment-generator|' docker.env
sed -i '' 's|NETWORK_NAME=.*|NETWORK_NAME=xdcsubnet|' docker.env
sed -i '' 's|NUM_MACHINE=.*|NUM_MACHINE=1|' docker.env
sed -i '' 's|NUM_SUBNET=.*|NUM_SUBNET=3|' docker.env
sed -i '' 's|MAIN_IP=.*|MAIN_IP=1.11.111.111|' docker.env
sed -i '' 's|PARENTCHAIN=.*|PARENTCHAIN=devnet|' docker.env
sed -i '' "s|PARENTCHAIN_WALLET=.*|PARENTCHAIN_WALLET=$WALLET_ADDRESS|" docker.env
sed -i '' "s|PARENTCHAIN_WALLET_PK=.*|PARENTCHAIN_WALLET_PK=$WALLET_PRIVATE_KEY|" docker.env

echo "update env file"
# Pull the latest subnet-generator image
echo "Pulling latest subnet-generator image..."
docker pull xinfinorg/subnet-generator:latest

# Generate all the required files in the generated directory
echo "Generating files..."
docker run --env-file docker.env -v $(pwd)/generated:/app/generated xinfinorg/subnet-generator:latest




# Check if the generated directory exists before trying to cd into it
if [ -d "~/.XinFin-Node/subnet/deployment-generator/generated" ]; then
    cd ~/.XinFin-Node/subnet/deployment-generator/generated
    docker compose --env-file docker-compose.env --profile machine1 pull
    docker compose --env-file docker-compose.env --profile machine1 up -d
    echo "Deployed subnet"
fi

# Deploy checkpoint smart contract
if [ -d "~/.XinFin-Node/subnet/deployment-generator" ]; then
    cd ~/.XinFin-Node/subnet/deployment-generator
    docker run --env-file docker.env -v $(pwd)/generated/deployment.json:/app/generated/deployment.json --entrypoint 'bash' xinfinorg/subnet-generator:latest ./deploy_csc.sh 
    echo "Deployed checkpoint smart contract"
fi

echo "Deployment complete"
# Start services and frontend
docker compose --env-file docker-compose.env --profile services pull
docker compose --env-file docker-compose.env --profile services up -d

echo "Started services and frontend"