#include "wal/wal_writer.hpp"
#include "wal/wal_record.hpp"
#include <cerrno>
#include <cstring>
#include <fcntl.h>
#include <iostream>
#include <unistd.h>
#include <cstdint>

namespace wal {

WalWriter::WalWriter(std::string path, bool sync_on_commit)
    : path_(std::move(path)), sync_(sync_on_commit),
      fd_(::open(path_.c_str(), O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC,
                 0644)) {
  if (fd_ < 0) {
    std::cerr << "WAL: cannot open " << path_ << ": " << std::strerror(errno)
              << "\n";
  }
}

WalWriter::~WalWriter() {
  if (fd_ >= 0) {
    ::close(fd_);
  }
}

bool WalWriter::commit(uint64_t txid, const std::vector<std::string> &records) {
  if (fd_ < 0) {
    return false;
  }

  std::string buf = begin_line(txid) + '\n';
  for (const std::string &r : records) {
    buf += r;
    buf += '\n';
  }
  buf += commit_line(txid);
  buf += '\n';

  const char *p = buf.data();
  size_t left = buf.size();
  while (left > 0) {
    ssize_t n = ::write(fd_, p, left);
    if (n < 0) {
      if (errno == EINTR) {
        continue;
      }
      std::cerr << "WAL: write failed: " << std::strerror(errno) << "\n";
      return false;
    }
    p += n;
    left -= static_cast<size_t>(n);
  }

  if (sync_ && ::fsync(fd_) != 0) {
    std::cerr << "WAL: fsync failed: " << std::strerror(errno) << "\n";
    return false;
  }
  return true;
}
// Add this to the very bottom of src/wal/wal_writer.cpp

static wal::WalWriter* global_wal_writer = nullptr;

extern "C" {
    // 1. Function to initialize the WAL writer with a file path from Rust
    bool c_wal_init(const char* path, bool sync_on_commit) {
        if (global_wal_writer != nullptr) {
            delete global_wal_writer;
        }
        global_wal_writer = new wal::WalWriter(std::string(path), sync_on_commit);
        return true;
    }

    // 2. Function to append records for your virtual traders
    bool c_wal_commit_records(uint64_t txid, const char** records_array, size_t array_len) {
        if (global_wal_writer == nullptr) {
            return false;
        }

        // Convert the C-style array of raw strings into a C++ std::vector<std::string>
        std::vector<std::string> cpp_records;
        cpp_records.reserve(array_len);
        for (size_t i = 0; i < array_len; ++i) {
            cpp_records.push_back(std::string(records_array[i]));
        }

        // Invoke your actual class method
        return global_wal_writer->commit(txid, cpp_records);
    }

    // 3. Function to safely close the file descriptor when shutting down
    void c_wal_close() {
        if (global_wal_writer != nullptr) {
            delete global_wal_writer;
            global_wal_writer = nullptr;
        }
    }
}

} // namespace wal
