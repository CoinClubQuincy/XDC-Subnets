# Uniswap Backend (FastAPI + web3.py)

A minimal-but-real service for programmatic swaps and liquidity ops on
Uniswap-style DEXes.

## Features

-   Auth & rate limiting
-   EIP-1559 gas policy
-   Uniswap v2/v3 quotes & swaps (multi-hop, fee-on-transfer)
-   Slippage handling
-   EIP-2612 permit support
-   DynamoDB logging & distributed rate limiting
-   AWS Lambda deployment (API & cron)

## Project layout

-   scripts/uniswap-backend.py
-   .env
-   requirements.txt

## Requirements

Python 3.10+, web3.py, FastAPI, uvicorn, boto3 (optional)

## Configuration

Environment variables (.env): - RPC_URL, CHAIN_ID, PRIVATE_KEY or
AWS_SECRET_NAME - WETH, UNIV2_ROUTER, UNIV3_SWAP_ROUTER, UNIV3_QUOTER,
RECIPIENT - API_KEY, RATE_LIMIT, RATE_WINDOW, RATE_TABLE, DDB_TABLE,
PRIVATE_RPC_URL

## Run locally

``` bash
uvicorn uniswap-backend:app --reload
```

## REST API

-   /erc20/allowance
-   /erc20/approve
-   /erc20/balance
-   /v2/quote, /v2/swap
-   /v3/quote, /v3/swap
-   /v3/quoteMulti, /v3/swapMulti
-   /erc20/permit/sign, /erc20/permit/submit
-   /index/receipt/{tx}

## AWS Deployment

-   Lambda handler: uniswap-backend.lambda_handler
-   Cron handler: uniswap-backend.cron_handler
-   EventBridge: cron(0 0 1 \* ? \*)

## Security

-   Use Secrets Manager & KMS for keys
-   Protect API with API_KEY / Gateway auth
-   Enable CloudWatch metrics, alarms, DLQ
