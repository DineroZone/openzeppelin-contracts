// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

library Vector {
    error Empty();
    error OutOfBound();

    struct Bytes32Vector {
        int128 begin;
        int128 end;
        mapping(int128 => bytes32) data;
    }

    function pushBack(Bytes32Vector storage vector, bytes32 value) internal {
        vector.data[vector.end++] = value;
    }

    function pushFront(Bytes32Vector storage vector, bytes32 value) internal {
        vector.data[--vector.begin] = value;
    }

    function popFront(Bytes32Vector storage vector) internal returns (bytes32 value) {
        if(empty(vector)) revert Empty();
        int128 idx = vector.begin++;
        value = vector.data[idx];
        delete vector.data[idx];
    }

    function popBack(Bytes32Vector storage vector) internal returns (bytes32 value) {
        if(empty(vector)) revert Empty();
        int128 idx = --vector.end;
        value = vector.data[idx];
        delete vector.data[idx];
    }

    function front(Bytes32Vector storage vector) internal view returns (bytes32 value) {
        if(empty(vector)) revert Empty();
        return vector.data[vector.begin];
    }

    function back(Bytes32Vector storage vector) internal view returns (bytes32 value) {
        if(empty(vector)) revert Empty();
        return vector.data[vector.end - 1];
    }

    function at(Bytes32Vector storage vector, uint256 i) internal view returns (bytes32 value) {
        int128 idx = vector.begin + int128(int256(i));
        if(idx >= vector.end) revert OutOfBound();
        return vector.data[idx];
    }

    function clear(Bytes32Vector storage vector) internal {
        vector.begin = 0;
        vector.end = 0;
    }

    function length(Bytes32Vector storage vector) internal view returns (uint256) {
        return uint256(uint128(vector.end - vector.begin));
    }

    function empty(Bytes32Vector storage vector) internal view returns (bool) {
        return length(vector) == 0;
    }
}
