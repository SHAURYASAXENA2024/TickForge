#include "wal/wal_writer.hpp"
#include "wal/wal_record.hpp"
#include <cerrno>
#include <cstring>
#include <fcntl.h>
#include <iostream>
#include <unistd.h>

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

} // namespace wal
