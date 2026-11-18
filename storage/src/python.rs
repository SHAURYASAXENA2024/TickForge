//! Python binding: `from tickforge_db import TickForgeDB` (see docs/CONTRACTS.md, section 4).
//!
//! Errors: bad arguments raise ValueError, file problems raise OSError.

use crate::{Database, DbError, IoBackend, OrderRow, Trade, STATUSES};
use pyo3::exceptions::{PyOSError, PyValueError};
use pyo3::prelude::*;
use pyo3::types::{PyDict, PyList};
use std::path::Path;

fn to_py_err(e: DbError) -> PyErr {
    match e {
        DbError::Io(e) => PyOSError::new_err(e.to_string()),
        DbError::Invalid(msg) => PyValueError::new_err(msg),
    }
}

/// Python ints arrive as i64 so that a negative value gives a clear ValueError.
fn non_negative(name: &str, value: i64) -> PyResult<u64> {
    u64::try_from(value).map_err(|_| PyValueError::new_err(format!("{name} must not be negative")))
}

fn trade_to_dict<'py>(py: Python<'py>, t: &Trade) -> PyResult<Bound<'py, PyDict>> {
    let d = PyDict::new(py);
    d.set_item("trade_id", t.trade_id)?;
    d.set_item("symbol", &t.symbol)?;
    d.set_item("price_cents", t.price_cents)?;
    d.set_item("quantity", t.quantity)?;
    d.set_item("buy_order_id", t.buy_order_id)?;
    d.set_item("sell_order_id", t.sell_order_id)?;
    d.set_item("buyer_id", t.buyer_id)?;
    d.set_item("seller_id", t.seller_id)?;
    d.set_item("timestamp_ms", t.timestamp_ms)?;
    d.set_item("buyer_name", &t.buyer_name)?;
    d.set_item("seller_name", &t.seller_name)?;
    Ok(d)
}

fn order_to_dict<'py>(py: Python<'py>, o: &OrderRow) -> PyResult<Bound<'py, PyDict>> {
    let d = PyDict::new(py);
    d.set_item("order_id", o.order_id)?;
    d.set_item("trader_id", o.trader_id)?;
    d.set_item("trader_name", &o.trader_name)?;
    d.set_item("side", if o.side == 0 { "BUY" } else { "SELL" })?;
    d.set_item("symbol", &o.symbol)?;
    d.set_item("quantity", o.quantity)?;
    d.set_item("price_cents", o.price_cents)?;
    d.set_item("status", STATUSES[o.status as usize])?;
    d.set_item("filled", o.filled)?;
    d.set_item("created_ms", o.created_ms)?;
    d.set_item("updated_ms", o.updated_ms)?;
    d.set_item("reason", &o.reason)?;
    Ok(d)
}

fn small(name: &str, value: i64) -> PyResult<u32> {
    u32::try_from(value).map_err(|_| PyValueError::new_err(format!("{name} must fit in 32 bits and not be negative")))
}

#[pyclass(name = "TickForgeDB")]
struct PyTickForgeDB {
    db: Database,
}

#[pymethods]
impl PyTickForgeDB {
    #[new]
    fn new(path: &str) -> PyResult<Self> {
        let io = match std::env::var("TICKFORGE_DB_IO").as_deref() {
            Err(_) | Ok("") | Ok("standard") => IoBackend::Standard,
            Ok("uring") => IoBackend::Uring,
            Ok(other) => {
                return Err(PyValueError::new_err(format!(
                    "TICKFORGE_DB_IO must be standard or uring, not {other}"
                )))
            }
        };
        let db = Database::open_with(Path::new(path), io).map_err(to_py_err)?;
        Ok(PyTickForgeDB { db })
    }

    #[pyo3(signature = (trade_id, symbol, price_cents, quantity, buy_order_id, sell_order_id, buyer_id, seller_id, timestamp_ms, buyer_name="", seller_name=""))]
    #[allow(clippy::too_many_arguments)]
    fn insert_trade(
        &mut self,
        trade_id: i64,
        symbol: &str,
        price_cents: i64,
        quantity: i64,
        buy_order_id: i64,
        sell_order_id: i64,
        buyer_id: i64,
        seller_id: i64,
        timestamp_ms: i64,
        buyer_name: &str,
        seller_name: &str,
    ) -> PyResult<()> {
        let trade = Trade {
            trade_id: non_negative("trade_id", trade_id)?,
            symbol: symbol.to_string(),
            price_cents,
            quantity: non_negative("quantity", quantity)?,
            buy_order_id: non_negative("buy_order_id", buy_order_id)?,
            sell_order_id: non_negative("sell_order_id", sell_order_id)?,
            buyer_id: non_negative("buyer_id", buyer_id)?,
            seller_id: non_negative("seller_id", seller_id)?,
            timestamp_ms: non_negative("timestamp_ms", timestamp_ms)?,
            buyer_name: buyer_name.to_string(),
            seller_name: seller_name.to_string(),
        };
        self.db.insert_trade(trade).map_err(to_py_err)
    }

    fn get_trade<'py>(
        &self,
        py: Python<'py>,
        trade_id: i64,
    ) -> PyResult<Option<Bound<'py, PyDict>>> {
        let id = non_negative("trade_id", trade_id)?;
        match self.db.get_trade(id).map_err(to_py_err)? {
            Some(t) => Ok(Some(trade_to_dict(py, &t)?)),
            None => Ok(None),
        }
    }

    #[pyo3(signature = (start_ms, end_ms, symbol=None))]
    fn range<'py>(
        &self,
        py: Python<'py>,
        start_ms: i64,
        end_ms: i64,
        symbol: Option<&str>,
    ) -> PyResult<Bound<'py, PyList>> {
        let start = non_negative("start_ms", start_ms)?;
        let end = non_negative("end_ms", end_ms)?;
        let trades = self.db.range(start, end, symbol).map_err(to_py_err)?;
        let list = PyList::empty(py);
        for t in &trades {
            list.append(trade_to_dict(py, t)?)?;
        }
        Ok(list)
    }

    /// Insert an order or replace the order with the same id. `side` is "BUY" or "SELL";
    /// `status` is one of open, partially_filled, filled, cancelled, rejected.
    #[pyo3(signature = (order_id, trader_id, trader_name, side, symbol, quantity, price_cents, status, filled, created_ms, updated_ms, reason=""))]
    #[allow(clippy::too_many_arguments)]
    fn upsert_order(
        &mut self,
        order_id: i64,
        trader_id: i64,
        trader_name: &str,
        side: &str,
        symbol: &str,
        quantity: i64,
        price_cents: i64,
        status: &str,
        filled: i64,
        created_ms: i64,
        updated_ms: i64,
        reason: &str,
    ) -> PyResult<()> {
        let side = match side {
            "BUY" => 0,
            "SELL" => 1,
            _ => return Err(PyValueError::new_err("side must be BUY or SELL")),
        };
        let status = STATUSES
            .iter()
            .position(|s| *s == status)
            .ok_or_else(|| PyValueError::new_err(format!("status must be one of {STATUSES:?}")))?
            as u8;
        let row = OrderRow {
            order_id: non_negative("order_id", order_id)?,
            trader_id: small("trader_id", trader_id)?,
            trader_name: trader_name.to_string(),
            side,
            symbol: symbol.to_string(),
            quantity: small("quantity", quantity)?,
            price_cents,
            status,
            filled: small("filled", filled)?,
            created_ms: non_negative("created_ms", created_ms)?,
            updated_ms: non_negative("updated_ms", updated_ms)?,
            reason: reason.to_string(),
        };
        self.db.upsert_order(row).map_err(to_py_err)
    }

    fn get_order<'py>(&self, py: Python<'py>, order_id: i64) -> PyResult<Option<Bound<'py, PyDict>>> {
        let id = non_negative("order_id", order_id)?;
        match self.db.get_order(id) {
            Some(o) => Ok(Some(order_to_dict(py, &o)?)),
            None => Ok(None),
        }
    }

    /// Newest first. `trader_id=None` lists every trader's orders.
    #[pyo3(signature = (trader_id=None, limit=100))]
    fn list_orders<'py>(&self, py: Python<'py>, trader_id: Option<i64>, limit: i64) -> PyResult<Bound<'py, PyList>> {
        let trader = trader_id.map(|t| small("trader_id", t)).transpose()?;
        let limit = usize::try_from(limit).map_err(|_| PyValueError::new_err("limit must not be negative"))?;
        let list = PyList::empty(py);
        for o in &self.db.list_orders(trader, limit) {
            list.append(order_to_dict(py, o)?)?;
        }
        Ok(list)
    }

    fn order_count(&self) -> usize {
        self.db.order_count()
    }

    /// The newest `limit` trades where this trader was the buyer or the seller, newest first.
    #[pyo3(signature = (trader_id, limit=200))]
    fn trades_by_trader<'py>(&self, py: Python<'py>, trader_id: i64, limit: i64) -> PyResult<Bound<'py, PyList>> {
        let id = non_negative("trader_id", trader_id)?;
        let limit = usize::try_from(limit).map_err(|_| PyValueError::new_err("limit must not be negative"))?;
        let list = PyList::empty(py);
        for t in &self.db.trades_of_trader(id, limit).map_err(to_py_err)? {
            list.append(trade_to_dict(py, t)?)?;
        }
        Ok(list)
    }

    fn count(&self) -> u64 {
        self.db.count()
    }

    fn flush(&mut self) -> PyResult<()> {
        self.db.flush().map_err(to_py_err)
    }

    fn compact(&mut self) -> PyResult<usize> {
        self.db.compact().map_err(to_py_err)
    }
}

#[pymodule]
fn tickforge_db(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<PyTickForgeDB>()?;
    Ok(())
}
