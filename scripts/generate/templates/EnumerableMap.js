const format = require('../format-lines');
const { fromBytes32, toBytes32 } = require('./conversion');

const TYPES = [
  { name: 'UintToUintMap', keyType: 'uint256', valueType: 'uint256' },
  { name: 'UintToAddressMap', keyType: 'uint256', valueType: 'address' },
  { name: 'AddressToUintMap', keyType: 'address', valueType: 'uint256' },
  { name: 'Bytes32ToUintMap', keyType: 'bytes32', valueType: 'uint256' },
];

/* eslint-disable max-len */
const header = `\
pragma solidity ^0.8.0;

import "./EnumerableSet.sol";

/**
 * @dev Library for managing an enumerable variant of Solidity's
 * https://solidity.readthedocs.io/en/latest/types.html#mapping-types[\`mapping\`]
 * type.
 *
 * Maps have the following properties:
 *
 * - Entries are added, removed, and checked for existence in constant time
 * (O(1)).
 * - Entries are enumerated in O(n). No guarantees are made on the ordering.
 *
 * \`\`\`
 * contract Example {
 *     // Add the library methods
 *     using EnumerableMap for EnumerableMap.UintToAddressMap;
 *
 *     // Declare a set state variable
 *     EnumerableMap.UintToAddressMap private myMap;
 * }
 * \`\`\`
 *
 * The following map types are supported:
 *
 * - \`uint256 -> address\` (\`UintToAddressMap\`) since v3.0.0
 * - \`address -> uint256\` (\`AddressToUintMap\`) since v4.6.0
 * - \`bytes32 -> bytes32\` (\`Bytes32ToBytes32Map\`) since v4.6.0
 * - \`uint256 -> uint256\` (\`UintToUintMap\`) since v4.7.0
 * - \`bytes32 -> uint256\` (\`Bytes32ToUintMap\`) since v4.7.0
 *
 * [WARNING]
 * ====
 * Trying to delete such a structure from storage will likely result in data corruption, rendering the structure
 * unusable.
 * See https://github.com/ethereum/solidity/pull/11843[ethereum/solidity#11843] for more info.
 *
 * In order to clean an EnumerableMap, you can either remove all elements one by one or create a fresh instance using an
 * array of EnumerableMap.
 * ====
 */
`;
/* eslint-enable max-len */

const defaultMap = () => `\
// To implement this library for multiple types with as little code
// repetition as possible, we write it in terms of a generic Map type with
// bytes32 keys and values.
// The Map implementation uses private functions, and user-facing
// implementations (such as Uint256ToAddressMap) are just wrappers around
// the underlying Map.
// This means that we can only create new EnumerableMaps for types that fit
// in bytes32.

struct Bytes32ToBytes32Map {
    // Storage of keys
    EnumerableSet.Bytes32Set _keys;
    mapping(bytes32 => bytes32) _values;
}

/**
 * @dev Adds a key-value pair to a map, or updates the value for an existing
 * key. O(1).
 *
 * Returns true if the key was added to the map, that is if it was not
 * already present.
 */
function set(
    Bytes32ToBytes32Map storage map,
    bytes32 key,
    bytes32 value
) internal returns (bool) {
    map._values[key] = value;
    return map._keys.add(key);
}

/**
 * @dev Removes a key-value pair from a map. O(1).
 *
 * Returns true if the key was removed from the map, that is if it was present.
 */
function remove(Bytes32ToBytes32Map storage map, bytes32 key) internal returns (bool) {
    delete map._values[key];
    return map._keys.remove(key);
}

/**
 * @dev Returns true if the key is in the map. O(1).
 */
function contains(Bytes32ToBytes32Map storage map, bytes32 key) internal view returns (bool) {
    return map._keys.contains(key);
}

/**
 * @dev Returns the number of key-value pairs in the map. O(1).
 */
function length(Bytes32ToBytes32Map storage map) internal view returns (uint256) {
    return map._keys.length();
}

/**
 * @dev Returns the key-value pair stored at position \`index\` in the map. O(1).
 *
 * Note that there are no guarantees on the ordering of entries inside the
 * array, and it may change when more entries are added or removed.
 *
 * Requirements:
 *
 * - \`index\` must be strictly less than {length}.
 */
function at(Bytes32ToBytes32Map storage map, uint256 index) internal view returns (bytes32, bytes32) {
    bytes32 key = map._keys.at(index);
    return (key, map._values[key]);
}

/**
 * @dev Tries to returns the value associated with \`key\`. O(1).
 * Does not revert if \`key\` is not in the map.
 */
function tryGet(Bytes32ToBytes32Map storage map, bytes32 key) internal view returns (bool, bytes32) {
    bytes32 value = map._values[key];
    if (value == bytes32(0)) {
        return (contains(map, key), bytes32(0));
    } else {
        return (true, value);
    }
}

/**
 * @dev Returns the value associated with \`key\`. O(1).
 *
 * Requirements:
 *
 * - \`key\` must be in the map.
 */
function get(Bytes32ToBytes32Map storage map, bytes32 key) internal view returns (bytes32) {
    bytes32 value = map._values[key];
    require(value != 0 || contains(map, key), "EnumerableMap: nonexistent key");
    return value;
}

/**
 * @dev Same as {get}, with a custom error message when \`key\` is not in the map.
 *
 * CAUTION: This function is deprecated because it requires allocating memory for the error
 * message unnecessarily. For custom revert reasons use {tryGet}.
 */
function get(
    Bytes32ToBytes32Map storage map,
    bytes32 key,
    string memory errorMessage
) internal view returns (bytes32) {
    bytes32 value = map._values[key];
    require(value != 0 || contains(map, key), errorMessage);
    return value;
}

/**
 * @dev Return the an array containing all the keys
 *
 * WARNING: This operation will copy the entire storage to memory, which can be quite expensive. This is designed
 * to mostly be used by view accessors that are queried without any gas fees. Developers should keep in mind that
 * this function has an unbounded cost, and using it as part of a state-changing function may render the function
 * uncallable if the set grows to a point where copying to memory consumes too much gas to fit in a block.
 */
function keys(Bytes32ToBytes32Map storage map) internal view returns (bytes32[] memory) {
    return map._keys.values();
}
`;

const customMap = ({ name, keyType, valueType }) => `\
// ${name}

struct ${name} {
    Bytes32ToBytes32Map _inner;
}

/**
 * @dev Adds a key-value pair to a map, or updates the value for an existing
 * key. O(1).
 *
 * Returns true if the key was added to the map, that is if it was not
 * already present.
 */
function set(
    ${name} storage map,
    ${keyType} key,
    ${valueType} value
) internal returns (bool) {
    return set(map._inner, ${toBytes32(keyType, 'key')}, ${toBytes32(valueType, 'value')});
}

/**
 * @dev Removes a value from a set. O(1).
 *
 * Returns true if the key was removed from the map, that is if it was present.
 */
function remove(${name} storage map, ${keyType} key) internal returns (bool) {
    return remove(map._inner, ${toBytes32(keyType, 'key')});
}

/**
 * @dev Returns true if the key is in the map. O(1).
 */
function contains(${name} storage map, ${keyType} key) internal view returns (bool) {
    return contains(map._inner, ${toBytes32(keyType, 'key')});
}

/**
 * @dev Returns the number of elements in the map. O(1).
 */
function length(${name} storage map) internal view returns (uint256) {
    return length(map._inner);
}

/**
 * @dev Returns the element stored at position \`index\` in the set. O(1).
 * Note that there are no guarantees on the ordering of values inside the
 * array, and it may change when more values are added or removed.
 *
 * Requirements:
 *
 * - \`index\` must be strictly less than {length}.
 */
function at(${name} storage map, uint256 index) internal view returns (${keyType}, ${valueType}) {
    (bytes32 key, bytes32 value) = at(map._inner, index);
    return (${fromBytes32(keyType, 'key')}, ${fromBytes32(valueType, 'value')});
}

/**
 * @dev Tries to returns the value associated with \`key\`. O(1).
 * Does not revert if \`key\` is not in the map.
 */
function tryGet(${name} storage map, ${keyType} key) internal view returns (bool, ${valueType}) {
    (bool success, bytes32 value) = tryGet(map._inner, ${toBytes32(keyType, 'key')});
    return (success, ${fromBytes32(valueType, 'value')});
}

/**
 * @dev Returns the value associated with \`key\`. O(1).
 *
 * Requirements:
 *
 * - \`key\` must be in the map.
 */
function get(${name} storage map, ${keyType} key) internal view returns (${valueType}) {
    return ${fromBytes32(valueType, `get(map._inner, ${toBytes32(keyType, 'key')})`)};
}

/**
 * @dev Same as {get}, with a custom error message when \`key\` is not in the map.
 *
 * CAUTION: This function is deprecated because it requires allocating memory for the error
 * message unnecessarily. For custom revert reasons use {tryGet}.
 */
function get(
    ${name} storage map,
    ${keyType} key,
    string memory errorMessage
) internal view returns (${valueType}) {
    return ${fromBytes32(valueType, `get(map._inner, ${toBytes32(keyType, 'key')}, errorMessage)`)};
}

/**
 * @dev Return the an array containing all the keys
 *
 * WARNING: This operation will copy the entire storage to memory, which can be quite expensive. This is designed
 * to mostly be used by view accessors that are queried without any gas fees. Developers should keep in mind that
 * this function has an unbounded cost, and using it as part of a state-changing function may render the function
 * uncallable if the set grows to a point where copying to memory consumes too much gas to fit in a block.
 */
function keys(${name} storage map) internal view returns (${keyType}[] memory) {
    bytes32[] memory store = keys(map._inner);
    ${keyType}[] memory result;

    /// @solidity memory-safe-assembly
    assembly {
        result := store
    }

    return result;
}
`;

// GENERATE
module.exports = format(
  header.trimEnd(),
  'library EnumerableMap {',
  [
    'using EnumerableSet for EnumerableSet.Bytes32Set;',
    '',
    defaultMap(),
    TYPES.map(details => customMap(details).trimEnd()).join('\n\n'),
  ],
  '}',
);
