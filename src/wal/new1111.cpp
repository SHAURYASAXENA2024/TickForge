#include <iostream>
#include <fstream>
#include <unordered_map>
#include <string>
using namespace std;

class WALDatabase {
private:
    unordered_map<string, string> data;
    const string walFile = "wal.log";

public:
    // Recover data from WAL after a crash
    void recover() {
        ifstream file(walFile);
        string operation, key, value;

        while (file >> operation >> key >> value) {
            if (operation == "PUT") {
                data[key] = value;
            }
        }

        file.close();
        cout << "Recovery completed.\n";
    }

    // Store operation in WAL before updating memory
    void put(string key, string value) {
        ofstream file(walFile, ios::app);

        file << "PUT " << key << " " << value << "\n";
        file.flush();
        file.close();

        data[key] = value;

        cout << "Data stored successfully.\n";
    }

    void get(string key) {
        if (data.find(key) != data.end()) {
            cout << key << " = " << data[key] << "\n";
        } else {
            cout << "Key not found.\n";
        }
    }
};

int main() {
    WALDatabase db;

    db.recover();

    int choice;
    string key, value;

    do {
        cout << "\n1. PUT\n2. GET\n3. Exit\n";
        cin >> choice;

        switch (choice) {
        case 1:
            cout << "Enter key and value: ";
            cin >> key >> value;
            db.put(key, value);
            break;

        case 2:
            cout << "Enter key: ";
            cin >> key;
            db.get(key);
            break;

        case 3:
            cout << "Exiting...\n";
            break;

        default:
            cout << "Invalid choice.\n";
        }
    } while (choice != 3);

    return 0;
}