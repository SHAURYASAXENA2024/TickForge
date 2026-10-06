from fastapi import FastAPI
from stocks import get_stock_data
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8443",
        "http://127.0.0.1:8443",
        "http://localhost:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/hello")
def hello():
    return {"message":"stock API is running "}


@app.get("/api/stocks/{symbol}")
def get_stock(symbol: str, range: str = "1d", interval: str = "5m"):
    return get_stock_data(symbol, range, interval)