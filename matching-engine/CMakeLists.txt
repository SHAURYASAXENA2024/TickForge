cmake_minimum_required(VERSION 3.15)
project(TickForgeMatchingEngine CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Threads REQUIRED)

add_executable(matching_engine
    src/main.cpp
    src/order_book.cpp
)

target_include_directories(matching_engine PRIVATE include)
target_link_libraries(matching_engine PRIVATE Threads::Threads)
target_compile_options(matching_engine PRIVATE -O2 -Wall)
