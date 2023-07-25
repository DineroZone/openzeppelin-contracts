// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import {SafeCast} from "../math/SafeCast.sol";

/**
 * @dev This library provides helpers for manipulating time-related objects.
 *
 * It uses the following types:
 * - `uint48` for timepoints
 * - `uint32` for durations
 *
 * While the library doesn't provide specific types for timepoints and duration, it does provide:
 * - a `Delay` type to represent duration that can be programmed to change value automatically at a given point
 * - additional helper functions
 */
library Time {
    using Time for *;

    /**
     * @dev Get the block timestamp as a Timepoint
     */
    function timestamp() internal view returns (uint48) {
        return SafeCast.toUint48(block.timestamp);
    }

    /**
     * @dev Get the block number as a Timepoint
     */
    function blockNumber() internal view returns (uint48) {
        return SafeCast.toUint48(block.number);
    }

    /**
     * @dev Check if a timepoint is set, and in the past
     */
    function isSetAndPast(uint48 timepoint, uint48 ref) internal pure returns (bool) {
        return timepoint != 0 && timepoint <= ref;
    }

    // ==================================================== Delay =====================================================
    /**
     * @dev A `Delay` is a uint32 duration that can be programmed to change value automatically at a given point in the
     * future. The "effect" timepoint describes when the transitions happens from the "old" value to the "new" value.
     * This allows updating the delay applied to some operation while keeping so guarantees.
     *
     * In particular, the {update} function guarantees that is the delay is reduced, the old delay still applies for
     * some time. For example if the delay is currently 7 days to do an upgrade, the admin should not be able to set
     * the delay to 0 and upgrade immediately. If the admin wants to reduce the delay, the old delay (7 days) should
     * still apply for some time.
     *
     *
     * The `Delay` type is 128 bits long, and packs the following:
     * [000:031] uint32 for the current value (duration)
     * [032:063] uint32 for the pending value (duration)
     * [064:111] uint48 for the effect date (timepoint)
     *
     * NOTE: The {get} and {update} function operate using timestamps. Block number based delays should use the
     * {getAt} and {updateAt} variants of these functions.
     */
    type Delay is uint112;

    /**
     * @dev Wrap a Duration into a Delay to add the one-step "update in the future" feature
     */
    function toDelay(uint32 duration) internal pure returns (Delay) {
        return Delay.wrap(duration);
    }

    /**
     * @dev Get the value the Delay will be at a given timepoint
     */
    function getAt(Delay self, uint48 timepoint) internal pure returns (uint32) {
        (uint32 oldValue, uint32 newValue, uint48 effect) = self.split();
        return (effect == 0 || effect > timepoint) ? oldValue : newValue;
    }

    /**
     * @dev Get the current value.
     */
    function get(Delay self) internal view returns (uint32) {
        return self.getAt(timestamp());
    }

    /**
     * @dev Get the pending value, and effect timepoint. If the effect timepoint is 0, then the pending value should
     * not be considered.
     */
    function getPending(Delay self) internal pure returns (uint32, uint48) {
        (, uint32 newValue, uint48 effect) = self.split();
        return (newValue, effect);
    }

    /**
     * @dev Update a Delay object so that a new duration takes effect at a given timepoint.
     */
    function updateAt(Delay self, uint32 newValue, uint48 effect) internal view returns (Delay) {
        return pack(self.get(), newValue, effect);
    }

    /**
     * @dev Update a Delay object so that it takes a new duration after at a timepoint that is automatically computed
     * to enforce the old delay at the moment of the update.
     */
    function update(Delay self, uint32 newValue) internal view returns (Delay) {
        uint32 value = self.get();
        uint32 setback = value > newValue ? value - newValue : 0; // todo: 0 means immediate update. ACDAR does something more opinionated
        return self.updateAt(newValue, timestamp() + setback);
    }

    /**
     * @dev Split a delay into its components: oldValue, newValue and effect (transition timepoint).
     */
    function split(Delay self) internal pure returns (uint32, uint32, uint48) {
        uint128 raw = Delay.unwrap(self);
        return (
            uint32(raw), // oldValue
            uint32(raw >> 32), // newValue
            uint48(raw >> 64) // effect
        );
    }

    /**
     * @dev pack the components into a Delay object.
     */
    function pack(uint32 oldValue, uint32 newValue, uint48 effect) internal pure returns (Delay) {
        return Delay.wrap(uint112(oldValue) | (uint112(newValue) << 32) | (uint112(effect) << 64));
    }
}
