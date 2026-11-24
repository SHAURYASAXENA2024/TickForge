//! The orders table: one row per order, updated as the order is filled or cancelled.
//!
//! It is a small append-only log of CRC-protected frames (the same frame shape as the
//! trade log: len u32, crc32 u32, payload). Every update appends the whole new row, and
//! on open the log is read back so the last row for each order id wins. A half-written
//! frame at the end is cut off. When the log holds many more frames than live rows it is
//! rewritten (to a `.tmp` file, then renamed), so it cannot grow without bound.

use crate::error::DbError;
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

/// Order states. Stored as one byte.
pub const STATUSES: [&str; 5] = ["open", "partially_filled", "filled", "cancelled", "rejected"];

#[derive(Debug, Clone, PartialEq, Default)]
pub struct OrderRow {
    pub order_id: u64,
    pub trader_id: u32,
    pub trader_name: String,
    /// 0 = BUY, 1 = SELL
    pub side: u8,
    pub symbol: String,
    pub quantity: u32,
    pub price_cents: i64,
    /// Index into [`STATUSES`].
    pub status: u8,
    pub filled: u32,
    pub created_ms: u64,
    pub updated_ms: u64,
    /// Why a rejected order was refused, empty otherwise.
    pub reason: String,
}

/// Bytes before the three strings.
const FIXED: usize = 8 + 8 + 8 + 8 + 4 + 4 + 4 + 1 + 1 + 1 + 1 + 1;

impl OrderRow {
    pub fn validate(&self) -> Result<(), DbError> {
        if self.order_id == 0 {
            return Err(DbError::Invalid("order_id must be positive".into()));
        }
        if self.side > 1 {
            return Err(DbError::Invalid("side must be 0 (BUY) or 1 (SELL)".into()));
        }
        if self.status as usize >= STATUSES.len() {
            return Err(DbError::Invalid("unknown status".into()));
        }
        if self.symbol.is_empty() || self.symbol.len() > 32 {
            return Err(DbError::Invalid("symbol must be 1 to 32 bytes".into()));
        }
        if self.trader_name.len() > 64 || self.reason.len() > 64 {
            return Err(DbError::Invalid("trader_name and reason must be at most 64 bytes".into()));
        }
        if self.filled > self.quantity {
            return Err(DbError::Invalid("filled cannot exceed quantity".into()));
        }
        Ok(())
    }

    fn encode(&self, out: &mut Vec<u8>) {
        out.extend_from_slice(&self.order_id.to_le_bytes());
        out.extend_from_slice(&self.price_cents.to_le_bytes());
        out.extend_from_slice(&self.created_ms.to_le_bytes());
        out.extend_from_slice(&self.updated_ms.to_le_bytes());
        out.extend_from_slice(&self.quantity.to_le_bytes());
        out.extend_from_slice(&self.filled.to_le_bytes());
        out.extend_from_slice(&self.trader_id.to_le_bytes());
        out.push(self.side);
        out.push(self.status);
        out.push(self.symbol.len() as u8);
        out.push(self.trader_name.len() as u8);
        out.push(self.reason.len() as u8);
        out.extend_from_slice(self.symbol.as_bytes());
        out.extend_from_slice(self.trader_name.as_bytes());
        out.extend_from_slice(self.reason.as_bytes());
    }

    fn decode(buf: &[u8]) -> Option<OrderRow> {
        if buf.len() < FIXED {
            return None;
        }
        let u64_at = |i: usize| u64::from_le_bytes(buf[i..i + 8].try_into().unwrap());
        let u32_at = |i: usize| u32::from_le_bytes(buf[i..i + 4].try_into().unwrap());
        let (sym, name, reason) = (
            buf[FIXED - 3] as usize,
            buf[FIXED - 2] as usize,
            buf[FIXED - 1] as usize,
        );
        if buf.len() != FIXED + sym + name + reason {
            return None;
        }
        let text = |from: usize, len: usize| String::from_utf8(buf[from..from + len].to_vec()).ok();
        Some(OrderRow {
            order_id: u64_at(0),
            price_cents: u64_at(8) as i64,
            created_ms: u64_at(16),
            updated_ms: u64_at(24),
            quantity: u32_at(32),
            filled: u32_at(36),
            trader_id: u32_at(40),
            side: buf[44],
            status: buf[45],
            symbol: text(FIXED, sym)?,
            trader_name: text(FIXED + sym, name)?,
            reason: text(FIXED + sym + name, reason)?,
        })
    }
}

fn frame(row: &OrderRow) -> Vec<u8> {
    let mut payload = Vec::new();
    row.encode(&mut payload);
    let mut out = Vec::with_capacity(8 + payload.len());
    out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    out.extend_from_slice(&crc32fast::hash(&payload).to_le_bytes());
    out.extend_from_slice(&payload);
    out
}

pub struct OrderTable {
    path: PathBuf,
    file: File,
    rows: HashMap<u64, OrderRow>,
    /// Frames in the log file, live or superseded.
    frames: usize,
}

/// Rewrite the log when it holds this many times more frames than live rows.
const REWRITE_FACTOR: usize = 4;
const REWRITE_MIN_FRAMES: usize = 4096;

impl OrderTable {
    pub fn open(path: &Path) -> Result<OrderTable, DbError> {
        let bytes = fs::read(path).unwrap_or_default();
        let mut rows: HashMap<u64, OrderRow> = HashMap::new();
        let (mut pos, mut frames) = (0usize, 0usize);
        while pos + 8 <= bytes.len() {
            let len = u32::from_le_bytes(bytes[pos..pos + 4].try_into().unwrap()) as usize;
            let crc = u32::from_le_bytes(bytes[pos + 4..pos + 8].try_into().unwrap());
            let end = pos + 8 + len;
            if end > bytes.len() || crc32fast::hash(&bytes[pos + 8..end]) != crc {
                break;
            }
            match OrderRow::decode(&bytes[pos + 8..end]) {
                Some(row) => {
                    rows.insert(row.order_id, row);
                }
                None => break,
            }
            frames += 1;
            pos = end;
        }
        let file = OpenOptions::new().read(true).append(true).create(true).open(path)?;
        if (pos as u64) < bytes.len() as u64 {
            file.set_len(pos as u64)?; // a half-written last frame
        }
        let mut table = OrderTable { path: path.to_path_buf(), file, rows, frames };
        table.rewrite_if_bloated()?;
        Ok(table)
    }

    /// Insert the row, or replace the row with the same order id. When this returns the
    /// row is in the log and survives a crash of this process.
    pub fn upsert(&mut self, row: OrderRow) -> Result<(), DbError> {
        row.validate()?;
        self.file.write_all(&frame(&row))?; // one write call per frame
        self.frames += 1;
        self.rows.insert(row.order_id, row);
        self.rewrite_if_bloated()
    }

    pub fn get(&self, order_id: u64) -> Option<&OrderRow> {
        self.rows.get(&order_id)
    }

    pub fn len(&self) -> usize {
        self.rows.len()
    }

    pub fn is_empty(&self) -> bool {
        self.rows.is_empty()
    }

    /// Newest orders first (by order id, which grows with time), at most `limit`,
    /// optionally only one trader's.
    pub fn list(&self, trader_id: Option<u32>, limit: usize) -> Vec<OrderRow> {
        let mut out: Vec<OrderRow> = self
            .rows
            .values()
            .filter(|r| trader_id.is_none_or(|t| r.trader_id == t))
            .cloned()
            .collect();
        out.sort_by(|a, b| b.order_id.cmp(&a.order_id));
        out.truncate(limit);
        out
    }

    fn rewrite_if_bloated(&mut self) -> Result<(), DbError> {
        if self.frames < REWRITE_MIN_FRAMES || self.frames < REWRITE_FACTOR * self.rows.len() {
            return Ok(());
        }
        let tmp = self.path.with_extension("log.tmp");
        let mut ids: Vec<&u64> = self.rows.keys().collect();
        ids.sort();
        let mut buf = Vec::new();
        for id in ids {
            buf.extend_from_slice(&frame(&self.rows[id]));
        }
        {
            let mut f = File::create(&tmp)?;
            f.write_all(&buf)?;
            f.sync_all()?;
        }
        fs::rename(&tmp, &self.path)?;
        self.file = OpenOptions::new().read(true).append(true).open(&self.path)?;
        self.frames = self.rows.len();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(id: u64) -> OrderRow {
        OrderRow {
            order_id: id,
            trader_id: 25,
            trader_name: "Kapinza".into(),
            side: 0,
            symbol: "AAPL".into(),
            quantity: 100,
            price_cents: 18950,
            status: 0,
            filled: 0,
            created_ms: 1_000 + id,
            updated_ms: 1_000 + id,
            reason: String::new(),
        }
    }

    #[test]
    fn round_trip_and_last_row_wins() {
        let dir = std::env::temp_dir().join(format!("tf-orders-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("orders.log");
        let _ = fs::remove_file(&path);
        {
            let mut t = OrderTable::open(&path).unwrap();
            t.upsert(row(1)).unwrap();
            t.upsert(row(2)).unwrap();
            let mut r = row(1);
            r.filled = 40;
            r.status = 1;
            r.updated_ms = 5_000;
            t.upsert(r).unwrap();
        }
        let t = OrderTable::open(&path).unwrap();
        assert_eq!(t.len(), 2);
        assert_eq!(t.get(1).unwrap().filled, 40);
        assert_eq!(t.get(1).unwrap().status, 1);
        assert_eq!(t.get(2).unwrap().trader_name, "Kapinza");
        assert_eq!(t.list(Some(25), 10).iter().map(|r| r.order_id).collect::<Vec<_>>(), vec![2, 1]);
        assert!(t.list(Some(3), 10).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_cut_off_last_frame_is_dropped() {
        let dir = std::env::temp_dir().join(format!("tf-orders-cut-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("orders.log");
        let _ = fs::remove_file(&path);
        {
            let mut t = OrderTable::open(&path).unwrap();
            t.upsert(row(1)).unwrap();
            t.upsert(row(2)).unwrap();
        }
        let len = fs::metadata(&path).unwrap().len();
        OpenOptions::new().write(true).open(&path).unwrap().set_len(len - 3).unwrap();
        let t = OrderTable::open(&path).unwrap();
        assert_eq!(t.len(), 1);
        assert!(t.get(1).is_some() && t.get(2).is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_log_is_rewritten_when_it_bloats() {
        let dir = std::env::temp_dir().join(format!("tf-orders-rw-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("orders.log");
        let _ = fs::remove_file(&path);
        let mut t = OrderTable::open(&path).unwrap();
        for i in 0..(REWRITE_MIN_FRAMES * 2) {
            let mut r = row(1 + (i as u64 % 3));
            r.filled = (i % 100) as u32;
            r.updated_ms = i as u64;
            t.upsert(r).unwrap();
        }
        assert!(t.frames < REWRITE_MIN_FRAMES * 2);
        drop(t);
        let t = OrderTable::open(&path).unwrap();
        assert_eq!(t.len(), 3);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn bad_rows_are_refused() {
        let mut r = row(1);
        r.filled = 101;
        assert!(r.validate().is_err());
        let mut r = row(1);
        r.status = 9;
        assert!(r.validate().is_err());
        let mut r = row(0);
        r.order_id = 0;
        assert!(r.validate().is_err());
    }
}
