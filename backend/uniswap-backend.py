"""
Project layout (single-file starter)

./app.py                 # FastAPI service – run with: uvicorn app:app --reload
.env                     # Environment variables (see EXAMPLE below)
requirements.txt         # Install with: pip install -r requirements.txt

You can later split into /core, /routers, /abis, etc. This starter keeps it compact.
"""

# =========================
# requirements.txt (paste into a file)
# -------------------------
# fastapi==0.115.0
# uvicorn[standard]==0.30.5
# web3==6.20.1
# pydantic==2.8.2
# python-dotenv==1.0.1
# eth-account==0.10.0
#
# Then: pip install -r requirements.txt
# =========================

# =========================
# .env (paste into a file; DO NOT commit real keys)
# -------------------------
# RPC_URL=https://your-node.example
# CHAIN_ID=1
# PRIVATE_KEY=0xabc...   # backend signer (hot wallet) – use HSM in prod
# WETH=0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2   # mainnet WETH
# UNIV2_ROUTER=0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D              # Uniswap V2 Router02
# UNIV3_SWAP_ROUTER=0xE592427A0AEce92De3Edee1F18E0157C05861564       # Uniswap V3 SwapRouter
# UNIV3_QUOTER=0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6            # Uniswap V3 QuoterV2
# RECIPIENT=0xYourOpsWallet                                         # default recipient if needed
# =========================

import os
import time
from decimal import Decimal
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
import logging, json
from datetime import datetime, timezone
try:
    import boto3
except ImportError:
    boto3 = None
try:
    from mangum import Mangum
except ImportError:
    Mangum = None

from pydantic import BaseModel, Field
from dotenv import load_dotenv
from web3 import Web3
from web3.middleware import construct_sign_and_send_raw_middleware
from eth_account import Account

load_dotenv()

# ---------- Logging / Observability ----------
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format='%(asctime)s %(levelname)s %(name)s %(message)s'
)
logger = logging.getLogger("uniswap-backend")

# ---------- Web3 setup ----------
RPC_URL = os.getenv("RPC_URL")
CHAIN_ID = int(os.getenv("CHAIN_ID", "1"))
PRIVATE_KEY = os.getenv("PRIVATE_KEY")

# Prefer AWS Secrets Manager if configured
AWS_SECRET_NAME = os.getenv("AWS_SECRET_NAME")
if not PRIVATE_KEY and AWS_SECRET_NAME and boto3:
    try:
        sm = boto3.client("secretsmanager")
        resp = sm.get_secret_value(SecretId=AWS_SECRET_NAME)
        secret_str = resp.get("SecretString")
        # Secret may be a raw hex key or JSON {"PRIVATE_KEY":"0x..."}
        if secret_str:
            try:
                PRIVATE_KEY = json.loads(secret_str).get("PRIVATE_KEY")
            except Exception:
                PRIVATE_KEY = secret_str
        logger.info("Loaded PRIVATE_KEY from Secrets Manager secret '%s'", AWS_SECRET_NAME)
    except Exception as e:
        logger.warning("Could not load secret '%s' from Secrets Manager: %s", AWS_SECRET_NAME, e)

if not RPC_URL:
    raise RuntimeError("Missing RPC_URL in .env")

w3 = Web3(Web3.HTTPProvider(RPC_URL, request_kwargs={"timeout": 60}))
if not w3.is_connected():
    raise RuntimeError("Web3 failed to connect – check RPC_URL")

acct = Account.from_key(PRIVATE_KEY) if PRIVATE_KEY else None
if acct:
    w3.middleware_onion.add(construct_sign_and_send_raw_middleware(acct))
    w3.eth.default_account = acct.address

# ---------- Addresses ----------
ADDR_WETH = Web3.to_checksum_address(os.getenv("WETH", "0x0000000000000000000000000000000000000000"))
ADDR_V2_ROUTER = Web3.to_checksum_address(os.getenv("UNIV2_ROUTER", "0x0000000000000000000000000000000000000000"))
ADDR_V3_SWAP_ROUTER = Web3.to_checksum_address(os.getenv("UNIV3_SWAP_ROUTER", "0x0000000000000000000000000000000000000000"))
ADDR_V3_QUOTER = Web3.to_checksum_address(os.getenv("UNIV3_QUOTER", "0x0000000000000000000000000000000000000000"))
DEFAULT_RECIPIENT = os.getenv("RECIPIENT")

# ---------- Service Config ----------
API_KEY = os.getenv("API_KEY")  # required if set
RATE_LIMIT = int(os.getenv("RATE_LIMIT", "60"))  # requests per window
RATE_WINDOW = int(os.getenv("RATE_WINDOW", "60"))  # seconds
RATE_TABLE = os.getenv("RATE_TABLE")  # optional DynamoDB table for distributed rate limiting
DDB_TABLE = os.getenv("DDB_TABLE")     # optional DynamoDB table for indexing/logging
PRIVATE_RPC_URL = os.getenv("PRIVATE_RPC_URL")  # optional MEV/private relay RPC

ddb = None
if boto3 and (RATE_TABLE or DDB_TABLE):
    try:
        ddb = boto3.resource("dynamodb")
    except Exception as e:
        logger.warning("DynamoDB client init failed: %s", e)
rate_table = ddb.Table(RATE_TABLE) if ddb and RATE_TABLE else None
log_table = ddb.Table(DDB_TABLE) if ddb and DDB_TABLE else None

# ---------- Minimal ABIs ----------
ERC20_ABI = [
    {"constant": True, "inputs": [{"name": "","type": "address"}], "name": "balanceOf", "outputs": [{"name": "","type": "uint256"}], "type": "function"},
    {"constant": True, "inputs": [], "name": "decimals", "outputs": [{"name": "","type": "uint8"}], "type": "function"},
    {"constant": True, "inputs": [{"name": "","type": "address"},{"name": "","type": "address"}], "name": "allowance", "outputs": [{"name": "","type": "uint256"}], "type": "function"},
    {"constant": False, "inputs": [{"name": "spender","type": "address"},{"name": "value","type": "uint256"}], "name": "approve", "outputs": [{"name": "","type": "bool"}], "type": "function"},
]

# Uniswap V2 Router02 minimal
V2_ROUTER_ABI = [
    {"name":"getAmountsOut","type":"function","stateMutability":"view","inputs":[{"name":"amountIn","type":"uint256"},{"name":"path","type":"address[]"}],"outputs":[{"name":"amounts","type":"uint256[]"}]},
    {"name":"swapExactTokensForTokens","type":"function","stateMutability":"nonpayable","inputs":[
        {"name":"amountIn","type":"uint256"},
        {"name":"amountOutMin","type":"uint256"},
        {"name":"path","type":"address[]"},
        {"name":"to","type":"address"},
        {"name":"deadline","type":"uint256"}
    ],"outputs":[{"name":"amounts","type":"uint256[]"}]},
]

# Uniswap V3 Quoter + SwapRouter (V2 quoter interface works for exactInputSingle)
V3_QUOTER_ABI = [
    {"name":"quoteExactInputSingle","type":"function","stateMutability":"nonpayable","inputs":[
        {"name":"tokenIn","type":"address"},
        {"name":"tokenOut","type":"address"},
        {"name":"fee","type":"uint24"},
        {"name":"amountIn","type":"uint256"},
        {"name":"sqrtPriceLimitX96","type":"uint160"}
    ],"outputs":[{"name":"amountOut","type":"uint256"}]}
]

V3_SWAP_ABI = [
    {"name":"exactInputSingle","type":"function","stateMutability":"payable","inputs":[
        {"name":"params","type":"tuple","components":[
            {"name":"tokenIn","type":"address"},
            {"name":"tokenOut","type":"address"},
            {"name":"fee","type":"uint24"},
            {"name":"recipient","type":"address"},
            {"name":"deadline","type":"uint256"},
            {"name":"amountIn","type":"uint256"},
            {"name":"amountOutMinimum","type":"uint256"},
            {"name":"sqrtPriceLimitX96","type":"uint160"}
        ]}
    ],"outputs":[{"name":"amountOut","type":"uint256"}]}
]

# Uniswap V2 Router supporting fee-on-transfer tokens
V2_ROUTER_ABI_SUPPORT = V2_ROUTER_ABI + [
    {"name":"swapExactTokensForTokensSupportingFeeOnTransferTokens","type":"function","stateMutability":"nonpayable","inputs":[
        {"name":"amountIn","type":"uint256"},
        {"name":"amountOutMin","type":"uint256"},
        {"name":"path","type":"address[]"},
        {"name":"to","type":"address"},
        {"name":"deadline","type":"uint256"}
    ],"outputs":[]}
]

# Uniswap V3 Quoter v2: quoteExactInput for multihop
V3_QUOTER_V2_ABI = V3_QUOTER_ABI + [
    {"name":"quoteExactInput","type":"function","stateMutability":"nonpayable","inputs":[
        {"name":"path","type":"bytes"},
        {"name":"amountIn","type":"uint256"}
    ],"outputs":[{"name":"amountOut","type":"uint256"}]}
]

# Uniswap V3 SwapRouter: exactInput for multihop
V3_SWAP_ABI_EXT = V3_SWAP_ABI + [
    {"name":"exactInput","type":"function","stateMutability":"payable","inputs":[
        {"name":"params","type":"tuple","components":[
            {"name":"path","type":"bytes"},
            {"name":"recipient","type":"address"},
            {"name":"deadline","type":"uint256"},
            {"name":"amountIn","type":"uint256"},
            {"name":"amountOutMinimum","type":"uint256"}
        ]}
    ],"outputs":[{"name":"amountOut","type":"uint256"}]}
]

# ERC20Permit minimal ABI
ERC20_PERMIT_ABI = ERC20_ABI + [
    {"name":"name","type":"function","stateMutability":"view","inputs":[],"outputs":[{"type":"string"}]},
    {"name":"nonces","type":"function","stateMutability":"view","inputs":[{"name":"owner","type":"address"}],"outputs":[{"type":"uint256"}]},
    {"name":"permit","type":"function","stateMutability":"nonpayable","inputs":[
        {"name":"owner","type":"address"},
        {"name":"spender","type":"address"},
        {"name":"value","type":"uint256"},
        {"name":"deadline","type":"uint256"},
        {"name":"v","type":"uint8"},
        {"name":"r","type":"bytes32"},
        {"name":"s","type":"bytes32"}
    ],"outputs":[]}
]

# ---------- Contract handles ----------
ERC20 = lambda addr: w3.eth.contract(address=Web3.to_checksum_address(addr), abi=ERC20_ABI)
V2_ROUTER = w3.eth.contract(address=ADDR_V2_ROUTER, abi=V2_ROUTER_ABI_SUPPORT)
V3_QUOTER = w3.eth.contract(address=ADDR_V3_QUOTER, abi=V3_QUOTER_V2_ABI)
V3_SWAP = w3.eth.contract(address=ADDR_V3_SWAP_ROUTER, abi=V3_SWAP_ABI_EXT)

# ---------- Helpers ----------
def now_plus(seconds: int = 300) -> int:
    return int(time.time()) + seconds

def to_wei(amount: Decimal, decimals: int) -> int:
    scale = Decimal(10) ** decimals
    return int((amount * scale).to_integral_value())

def from_wei(amount: int, decimals: int) -> Decimal:
    return Decimal(amount) / (Decimal(10) ** decimals)

# ---------- Gas / Fees (EIP-1559) ----------
def suggest_fees():
    try:
        hist = w3.eth.fee_history(5, 'latest', [15])
        base = int(hist['baseFeePerGas'][-1])
        # take median priority among the last blocks if available
        rewards = hist.get('reward') or []
        tip = int(sum(int(r[0]) for r in rewards) / max(len(rewards), 1)) if rewards else w3.to_wei(1, 'gwei')
        max_fee = base + tip * 2  # headroom
        return max_fee, tip
    except Exception:
        gp = int(w3.eth.gas_price)
        return gp, w3.to_wei(1, 'gwei')

def with_fees_and_nonce(tx: dict) -> dict:
    max_fee, tip = suggest_fees()
    tx.setdefault('chainId', CHAIN_ID)
    tx.setdefault('nonce', w3.eth.get_transaction_count(acct.address))
    tx.setdefault('type', 2)
    tx.setdefault('maxFeePerGas', max_fee)
    tx.setdefault('maxPriorityFeePerGas', tip)
    return tx

def estimate_and_fill_gas(tx: dict) -> dict:
    try:
        gas = w3.eth.estimate_gas(tx)
        tx.setdefault('gas', int(gas * 12 // 10))  # +20% headroom
    except Exception as e:
        logger.warning("Gas estimation failed, sending without gas: %s", e)
    return tx

def send_signed(tx: dict) -> str:
    # Choose provider (private relay if configured)
    provider = w3
    if PRIVATE_RPC_URL:
        try:
            provider = Web3(Web3.HTTPProvider(PRIVATE_RPC_URL))
        except Exception as e:
            logger.warning("Private RPC init failed: %s", e)
    signed = w3.eth.account.sign_transaction(tx, PRIVATE_KEY)
    tx_hash = provider.eth.send_raw_transaction(signed.rawTransaction)
    return tx_hash.hex()

# ---------- V3 path encoding ----------
def encode_v3_path(tokens: List[str], fees: List[int]) -> bytes:
    if len(fees) != len(tokens) - 1:
        raise ValueError("fees length must equal tokens length - 1")
    path = b''
    for i in range(len(fees)):
        path += Web3.to_bytes(hexstr=Web3.to_checksum_address(tokens[i]))
        path += int(fees[i]).to_bytes(3, 'big')
    path += Web3.to_bytes(hexstr=Web3.to_checksum_address(tokens[-1]))
    return path

# ---------- Simple DDB logging ----------
def log_swap(tx_hash: str, meta: dict):
    logger.info("swap_submitted tx=%s meta=%s", tx_hash, meta)
    if log_table:
        try:
            item = {
                'pk': tx_hash,
                'ts': int(datetime.now(timezone.utc).timestamp()),
                'meta': json.dumps(meta),
            }
            log_table.put_item(Item=item)
        except Exception as e:
            logger.warning("DDB put_item failed: %s", e)

# ---------- Auth & Rate Limiting ----------
_rate_cache = {}

async def auth_dep(request: Request):
    if not API_KEY:
        return  # open in dev if API_KEY not set
    key = request.headers.get('X-API-Key')
    if key != API_KEY:
        raise HTTPException(status_code=401, detail='Unauthorized')

def _rate_key(key: str) -> str:
    return f"rate::{key}"

async def rate_limit_dep(request: Request):
    # key by API key if present, else by client host
    ident = (request.headers.get('X-API-Key') or request.client.host or 'anon')
    now = int(time.time())
    window = now // RATE_WINDOW

    if rate_table:  # distributed limit
        rk = _rate_key(ident)
        try:
            resp = rate_table.update_item(
                Key={'pk': rk},
                UpdateExpression='SET #w = if_not_exists(#w, :w), #c = if_not_exists(#c, :zero) + :one',
                ExpressionAttributeNames={'#w': 'window', '#c': 'count'},
                ExpressionAttributeValues={':w': window, ':zero': 0, ':one': 1},
                ReturnValues='ALL_NEW'
            )
            item = resp['Attributes']
            # reset if window changed
            if item['window'] != window:
                rate_table.put_item(Item={'pk': rk, 'window': window, 'count': 1})
                count = 1
            else:
                count = item['count']
            if count > RATE_LIMIT:
                raise HTTPException(429, f'Rate limit exceeded: {count}/{RATE_LIMIT} in {RATE_WINDOW}s')
        except HTTPException:
            raise
        except Exception as e:
            logger.warning('Rate table error: %s', e)
            # fall back to local
    # local limiter
    key = (ident, window)
    cnt = _rate_cache.get(key, 0) + 1
    _rate_cache[key] = cnt
    # garbage collect old window
    for (ident_k, win_k) in list(_rate_cache.keys()):
        if win_k != window:
            _rate_cache.pop((ident_k, win_k), None)
    if cnt > RATE_LIMIT:
        raise HTTPException(429, f'Rate limit exceeded: {cnt}/{RATE_LIMIT} in {RATE_WINDOW}s')

# ---------- FastAPI ----------
app = FastAPI(title="Uniswap Backend (Python)", version="0.2.0", dependencies=[Depends(auth_dep), Depends(rate_limit_dep)])
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.time()
    try:
        response = await call_next(request)
        return response
    finally:
        duration = (time.time() - start) * 1000
        logger.info("%s %s %s %.2fms", request.method, request.url.path, request.client.host if request.client else '-', duration)

@app.get("/health")
def health():
    return {
        "ok": True,
        "chain_id": CHAIN_ID,
        "web3": w3.client_version,
        "signer": acct.address if acct else None,
    }

@app.get("/config")
def config():
    return {
        "WETH": ADDR_WETH,
        "UNIV2_ROUTER": ADDR_V2_ROUTER,
        "UNIV3_SWAP_ROUTER": ADDR_V3_SWAP_ROUTER,
        "UNIV3_QUOTER": ADDR_V3_QUOTER,
    }

@app.post("/erc20/allowance")
def allowance(q: AllowanceQuery):
    owner = Web3.to_checksum_address(q.owner or (acct.address if acct else "0x0"))
    spender = Web3.to_checksum_address(q.spender)
    token = ERC20(q.token)
    try:
        value = token.functions.allowance(owner, spender).call()
        return {"owner": owner, "spender": spender, "allowance": str(value)}
    except Exception as e:
        raise HTTPException(400, f"allowance failed: {e}")

@app.post("/erc20/approve")
def approve(body: ApproveBody):
    if not acct:
        raise HTTPException(400, "Server has no PRIVATE_KEY configured")
    token = ERC20(body.token)
    try:
        tx = token.functions.approve(Web3.to_checksum_address(body.spender), int(body.amount)).build_transaction({
            "from": acct.address,
        })
        tx = with_fees_and_nonce(tx)
        tx = estimate_and_fill_gas(tx)
        tx_hash = send_signed(tx)
        return {"tx": tx_hash}
    except Exception as e:
        raise HTTPException(400, f"approve failed: {e}")

@app.post("/v2/quote")
def v2_quote(body: QuoteV2Body):
    try:
        amounts = V2_ROUTER.functions.getAmountsOut(int(body.amount_in), [Web3.to_checksum_address(a) for a in body.path]).call()
        return {"amounts": [str(a) for a in amounts]}
    except Exception as e:
        raise HTTPException(400, f"v2 quote failed: {e}")

@app.post("/v2/swap")
def v2_swap(body: SwapV2Body):
    if not acct:
        raise HTTPException(400, "Server has no PRIVATE_KEY configured")
    to_addr = Web3.to_checksum_address(body.to or DEFAULT_RECIPIENT or acct.address)
    deadline = body.deadline or now_plus(300)
    # compute amountOutMin from quote if not provided
    amount_out_min = body.amount_out_min
    if amount_out_min is None:
        amounts = V2_ROUTER.functions.getAmountsOut(int(body.amount_in), [Web3.to_checksum_address(a) for a in body.path]).call()
        quoted_out = int(amounts[-1])
        amount_out_min = str(quoted_out * (10_000 - body.slippage_bps) // 10_000)
    try:
        fn = V2_ROUTER.functions.swapExactTokensForTokensSupportingFeeOnTransferTokens if body.support_fee_on_transfer else V2_ROUTER.functions.swapExactTokensForTokens
        tx = fn(
            int(body.amount_in),
            int(amount_out_min),
            [Web3.to_checksum_address(a) for a in body.path],
            to_addr,
            int(deadline),
        ).build_transaction({
            "from": acct.address,
        })
        tx = with_fees_and_nonce(tx)
        tx = estimate_and_fill_gas(tx)
        tx_hash = send_signed(tx)
        log_swap(tx_hash, {"version":"v2","path": body.path, "amount_in": body.amount_in, "amount_out_min": amount_out_min})
        return {"tx": tx_hash}
    except Exception as e:
        raise HTTPException(400, f"v2 swap failed: {e}")

@app.post("/v3/quote")
def v3_quote(body: QuoteV3Body):
    try:
        out_amt = V3_QUOTER.functions.quoteExactInputSingle(
            Web3.to_checksum_address(body.token_in),
            Web3.to_checksum_address(body.token_out),
            int(body.fee),
            int(body.amount_in),
            int(body.sqrt_price_limit_x96),
        ).call()
        return {"amount_out": str(out_amt)}
    except Exception as e:
        raise HTTPException(400, f"v3 quote failed: {e}")

@app.post("/v3/swap")
def v3_swap(body: SwapV3Body):
    if not acct:
        raise HTTPException(400, "Server has no PRIVATE_KEY configured")
    # compute amountOutMin if not provided
    amount_out_min = body.amount_out_min
    if amount_out_min is None:
        out_amt = V3_QUOTER.functions.quoteExactInputSingle(
            Web3.to_checksum_address(body.token_in),
            Web3.to_checksum_address(body.token_out),
            int(body.fee),
            int(body.amount_in),
            int(body.sqrt_price_limit_x96),
        ).call()
        amount_out_min = str(int(out_amt) * (10_000 - body.slippage_bps) // 10_000)

    params = (
        Web3.to_checksum_address(body.token_in),
        Web3.to_checksum_address(body.token_out),
        int(body.fee),
        Web3.to_checksum_address(body.recipient or DEFAULT_RECIPIENT or acct.address),
        int(body.deadline or now_plus(300)),
        int(body.amount_in),
        int(amount_out_min),
        int(body.sqrt_price_limit_x96),
    )
    try:
        tx = V3_SWAP.functions.exactInputSingle(params).build_transaction({
            "from": acct.address,
        })
        tx = with_fees_and_nonce(tx)
        tx = estimate_and_fill_gas(tx)
        tx_hash = send_signed(tx)
        log_swap(tx_hash, {"version":"v3","token_in": body.token_in, "token_out": body.token_out, "fee": body.fee, "amount_in": body.amount_in, "amount_out_min": amount_out_min})
        return {"tx": tx_hash}
    except Exception as e:
        raise HTTPException(400, f"v3 swap failed: {e}")

@app.post("/v3/quoteMulti")
def v3_quote_multi(body: QuoteV3MultiBody):
    try:
        path = encode_v3_path(body.tokens, body.fees)
        out_amt = V3_QUOTER.functions.quoteExactInput(path, int(body.amount_in)).call()
        return {"amount_out": str(out_amt)}
    except Exception as e:
        raise HTTPException(400, f"v3 multihop quote failed: {e}")

@app.post("/v3/swapMulti")
def v3_swap_multi(body: SwapV3MultiBody):
    if not acct:
        raise HTTPException(400, "Server has no PRIVATE_KEY configured")
    try:
        amount_out_min = body.amount_out_min
        if amount_out_min is None:
            path_q = encode_v3_path(body.tokens, body.fees)
            out_amt = V3_QUOTER.functions.quoteExactInput(path_q, int(body.amount_in)).call()
            amount_out_min = str(int(out_amt) * (10_000 - body.slippage_bps) // 10_000)
        path = encode_v3_path(body.tokens, body.fees)
        params = (
            path,
            Web3.to_checksum_address(body.recipient or DEFAULT_RECIPIENT or acct.address),
            int(now_plus(300)),
            int(body.amount_in),
            int(amount_out_min),
        )
        tx = V3_SWAP.functions.exactInput(params).build_transaction({"from": acct.address})
        tx = with_fees_and_nonce(tx)
        tx = estimate_and_fill_gas(tx)
        tx_hash = send_signed(tx)
        log_swap(tx_hash, {"version":"v3-multi","tokens": body.tokens, "fees": body.fees, "amount_in": body.amount_in, "amount_out_min": amount_out_min})
        return {"tx": tx_hash}
    except Exception as e:
        raise HTTPException(400, f"v3 multihop swap failed: {e}")

@app.post("/erc20/permit/sign")
def erc20_permit_sign(p: PermitBody):
    if not acct:
        raise HTTPException(400, "Server has no PRIVATE_KEY configured")
    owner = Web3.to_checksum_address(p.owner or acct.address)
    spender = Web3.to_checksum_address(p.spender)
    token = w3.eth.contract(address=Web3.to_checksum_address(p.token), abi=ERC20_PERMIT_ABI)
    try:
        name = token.functions.name().call()
    except Exception:
        name = "ERC20"
    nonce = int(token.functions.nonces(owner).call())
    domain = {
        "name": name,
        "version": "1",
        "chainId": CHAIN_ID,
        "verifyingContract": Web3.to_checksum_address(p.token),
    }
    message = {
        "owner": owner,
        "spender": spender,
        "value": int(p.value),
        "nonce": nonce,
        "deadline": int(p.deadline),
    }
    typed = {
        "types": {
            "EIP712Domain": [
                {"name":"name","type":"string"},
                {"name":"version","type":"string"},
                {"name":"chainId","type":"uint256"},
                {"name":"verifyingContract","type":"address"}
            ],
            "Permit": [
                {"name":"owner","type":"address"},
                {"name":"spender","type":"address"},
                {"name":"value","type":"uint256"},
                {"name":"nonce","type":"uint256"},
                {"name":"deadline","type":"uint256"}
            ]
        },
        "primaryType": "Permit",
        "domain": domain,
        "message": message,
    }
    signed = w3.eth.account.sign_typed_data(typed, private_key=PRIVATE_KEY)
    v, r, s = signed.v, Web3.to_hex(signed.r), Web3.to_hex(signed.s)
    return {"domain": domain, "message": message, "v": v, "r": r, "s": s}

@app.post("/erc20/permit/submit")
def erc20_permit_submit(p: PermitBody, v: int, r: str, s: str):
    if not acct:
        raise HTTPException(400, "Server has no PRIVATE_KEY configured")
    owner = Web3.to_checksum_address(p.owner or acct.address)
    spender = Web3.to_checksum_address(p.spender)
    token = w3.eth.contract(address=Web3.to_checksum_address(p.token), abi=ERC20_PERMIT_ABI)
    tx = token.functions.permit(owner, spender, int(p.value), int(p.deadline), int(v), Web3.to_bytes(hexstr=r), Web3.to_bytes(hexstr=s)).build_transaction({"from": owner})
    tx = with_fees_and_nonce(tx)
    tx = estimate_and_fill_gas(tx)
    tx_hash = send_signed(tx)
    return {"tx": tx_hash}

@app.get("/index/receipt/{tx_hash}")
def fetch_and_log_receipt(tx_hash: str):
    try:
        rc = w3.eth.get_transaction_receipt(tx_hash)
        data = {
            "status": rc.status,
            "gasUsed": rc.gasUsed,
            "blockNumber": rc.blockNumber,
            "effectiveGasPrice": rc.effectiveGasPrice,
        }
        log_swap(tx_hash, data)
        return data
    except Exception as e:
        raise HTTPException(400, f"receipt fetch failed: {e}")

@app.post("/erc20/balance")
def erc20_balance(q: BalanceQuery):
    owner = Web3.to_checksum_address(q.owner or (acct.address if acct else "0x0"))
    token = ERC20(q.token)
    try:
        bal = token.functions.balanceOf(owner).call()
        dec = token.functions.decimals().call()
        logger.info("balance_check token=%s owner=%s", q.token, owner)
        return {"owner": owner, "balance": str(bal), "human": str(from_wei(bal, dec))}
    except Exception as e:
        raise HTTPException(400, f"balance failed: {e}")

# ---------- TODOs / What you're missing (short list) ----------
# 1) Auth & rate limiting: protect these endpoints if public.
# 2) Robust gas/fee policy: add base + priority EIP-1559 logic; fallback to node estimates.
# 3) Approvals/permits: EIP-2612 permit flow to skip approve txs where supported.
# 4) Pathfinding (v2) & routing (v3 multi-hop): add exactInput(byte path) for multi-hop.
# 5) Slippage policy: compute amountOutMin from quotes (e.g., basis points input).
# 6) MEV-aware submission: bundle / private tx for large trades.
# 7) Indexing/analytics: run a Subgraph or logs consumer for P&L, TVL, LP fees.
# 8) Token hygiene: handle fee-on-transfer/rebasing tokens and non-standard decimals.
# 9) Secrets: move PRIVATE_KEY to HSM or KMS; support multiple signers per-asset bucket.
# 10) Observability: structured logs, metrics, alerts, dead-letter for failed ops.

# ---------- AWS Lambda adapters ----------
# API Gateway/Function URL handler (only if Mangum is installed)
if Mangum:
    lambda_handler = Mangum(app)

def cron_handler(event, context):
    """Monthly cron entrypoint. Extend with your own maintenance tasks (indexing, settlements, etc.)."""
    logger.info("cron_handler invoked: %s", json.dumps(event) if isinstance(event, dict) else str(event))
    # Example: no-op or future indexing sweep
    return {"ok": True, "ts": int(time.time())}

# Run locally: uvicorn app:app --reload
# Lambda (API): set handler to `uniswap-backend.lambda_handler`
# Lambda (Cron): set handler to `uniswap-backend.cron_handler` and create an EventBridge rule (e.g., schedule expression: cron(0 0 1 * ? *))

# ---------- Schemas ----------
class ApproveBody(BaseModel):
    token: str
    spender: str = Field(default_factory=lambda: ADDR_V2_ROUTER)
    amount: str = Field(..., description="string integer in token units (wei)")

class AllowanceQuery(BaseModel):
    token: str
    owner: Optional[str] = None
    spender: str = Field(default_factory=lambda: ADDR_V2_ROUTER)

class QuoteV2Body(BaseModel):
    amount_in: str
    path: List[str]

class SwapV2Body(BaseModel):
    amount_in: str
    amount_out_min: Optional[str] = None
    path: List[str]
    to: Optional[str] = None
    deadline: Optional[int] = None
    slippage_bps: int = 50  # 0.5% default
    support_fee_on_transfer: bool = False

class QuoteV3Body(BaseModel):
    token_in: str
    token_out: str
    fee: int = 3000
    amount_in: str
    sqrt_price_limit_x96: int = 0

class SwapV3Body(BaseModel):
    token_in: str
    token_out: str
    fee: int = 3000
    amount_in: str
    amount_out_min: Optional[str] = None
    recipient: Optional[str] = None
    deadline: Optional[int] = None
    sqrt_price_limit_x96: int = 0
    slippage_bps: int = 50

class QuoteV3MultiBody(BaseModel):
    tokens: List[str]
    fees: List[int]
    amount_in: str

class SwapV3MultiBody(BaseModel):
    tokens: List[str]
    fees: List[int]
    amount_in: str
    amount_out_min: Optional[str] = None
    recipient: Optional[str] = None
    deadline: Optional[int] = None
    slippage_bps: int = 50

class BalanceQuery(BaseModel):
    token: str
    owner: Optional[str] = None

class PermitBody(BaseModel):
    token: str
    owner: Optional[str] = None
    spender: str
    value: str
    deadline: int
