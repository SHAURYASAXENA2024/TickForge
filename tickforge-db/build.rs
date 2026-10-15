// tickforge-db/build.rs
fn main() {
    cc::Build::new()
        .cpp(true)
        .std("c++17")
        
        // 1. Existing includes
        .include("../include")
        
        // 2. ADD THIS EXACT PATH: Points to where order.hpp lives relative to tickforge-db
        .include("../matching-engine/include") 
        
        .file("../src/wal/wal_database.cpp")
        .file("../src/wal/wal_reader.cpp")
        .file("../src/wal/wal_record.cpp")
        .file("../src/wal/wal_writer.cpp")
        .compile("tickforge_wal_static");

    println!("cargo:rerun-if-changed=../src/wal/wal_database.cpp");
    println!("cargo:rerun-if-changed=../src/wal/wal_writer.cpp");
}
