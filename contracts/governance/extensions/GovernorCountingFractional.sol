// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import {Governor} from "../Governor.sol";
import {GovernorCountingSimple} from "./GovernorCountingSimple.sol";
import {Math} from "../../utils/math/Math.sol";

/**
 * @dev Extension of {Governor} for fractional voting.
 *
 * Similar to {GovernorCountingSimple}, this contract is a votes counting module for {Governor} that supports 3 options:
 * Against, For, Abstain. Additionally, it includes a fourth option: Fractional, which allows voters to split their voting
 * power amongst the other 3 options.
 *
 * Votes cast with the Fractional support must be accompanied by a `params` argument that is tree packed `uint128` values
 * representing the weight the delegate assigns to Against, For, and Abstain respectively. For those votes cast for the other
 * 3 options, the `params` argument must be empty.
 *
 * This is mostly useful when the delegate is a contract that implements its own rules for voting. These delegate-contracts
 * can cast fractional votes according to the preferences of multiple entities delegating their voting power.
 *
 * Some example use cases include:
 *
 * * Voting from tokens that are held by a DeFi pool
 * * Voting from an L2 with tokens held by a bridge
 * * Voting privately from a shielded pool using zero knowledge proofs.
 *
 * Based on ScopeLift's GovernorCountingFractional[https://github.com/ScopeLift/flexible-voting/blob/e5de2efd1368387b840931f19f3c184c85842761/src/GovernorCountingFractional.sol]
 */
abstract contract GovernorCountingFractional is Governor {
    using Math for *;

    uint8 internal constant VOTE_TYPE_FRACTIONAL = 255;

    struct ProposalVote {
        uint256 againstVotes;
        uint256 forVotes;
        uint256 abstainVotes;
        mapping(address voter => uint256) usedVotes;
    }

    /**
     * @dev Mapping from proposal ID to vote tallies for that proposal.
     */
    mapping(uint256 => ProposalVote) private _proposalVotes;

    /**
     * @dev A fractional vote params uses more votes than are available for that user.
     */
    error GovernorExceedRemainingWeight(address voter, uint256 usedVotes, uint256 remainingWeight);

    /**
     * @dev See {IGovernor-COUNTING_MODE}.
     */
    // solhint-disable-next-line func-name-mixedcase
    function COUNTING_MODE() public pure virtual override returns (string memory) {
        return "support=bravo,fractional&quorum=for,abstain&params=fractional";
    }

    /**
     * @dev See {IGovernor-hasVoted}.
     */
    function hasVoted(uint256 proposalId, address account) public view virtual override returns (bool) {
        return usedVotes(proposalId, account) > 0;
    }

    /**
     * @dev Get the number of votes already cast by `account` for a proposal with `proposalId`. Useful for
     * integrations that allow delegates to cast rolling, partial votes.
     */
    function usedVotes(uint256 proposalId, address account) public view virtual returns (uint256) {
        return _proposalVotes[proposalId].usedVotes[account];
    }

    /**
     * @dev Get current distribution of votes for a given proposal.
     */
    function proposalVotes(
        uint256 proposalId
    ) public view virtual returns (uint256 againstVotes, uint256 forVotes, uint256 abstainVotes) {
        ProposalVote storage proposalVote = _proposalVotes[proposalId];
        return (proposalVote.againstVotes, proposalVote.forVotes, proposalVote.abstainVotes);
    }

    /**
     * @dev See {Governor-_quorumReached}.
     */
    function _quorumReached(uint256 proposalId) internal view virtual override returns (bool) {
        ProposalVote storage proposalVote = _proposalVotes[proposalId];
        return quorum(proposalSnapshot(proposalId)) <= proposalVote.forVotes + proposalVote.abstainVotes;
    }

    /**
     * @dev See {Governor-_voteSucceeded}. In this module, forVotes must be > againstVotes.
     */
    function _voteSucceeded(uint256 proposalId) internal view virtual override returns (bool) {
        ProposalVote storage proposalVote = _proposalVotes[proposalId];
        return proposalVote.forVotes > proposalVote.againstVotes;
    }

    /**
     * @dev See {Governor-_countVote}. Function that records the delegate's votes.
     *
     * Executing this function consume's the delegate's weight on the proposal. This weight can be distributed amongst
     * the 3 options (Against, For, Abstain) by specifying a Fractional `support`.
     *
     * When support is anything other than Fractional, the `params` argument must be empty and the delegate's full remaining
     * weight is cast for the specified `support` option, as in {GovernorCountingSimple} and following the `VoteType`
     * enum from Governor Bravo.
     *
     * Given a Fractional `support`, the `params` argument must be tree packed `uint128` values representing the weight
     * the delegate assigns to Against, For, and Abstain respectively. This format can be produced using:
     *
     * `abi.encodePacked(uint128(againstVotes), uint128(forVotes), uint128(abstainVotes))`
     *
     * The sum total of the three decoded vote weights _must_ be less than or equal to the delegate's remaining weight
     * on the proposal, i.e. their checkpointed total weight minus votes already cast on the proposal.
     *
     * NOTE: Consider the number of votes is restricted to 128 bits. Depending on how many decimals the underlying token
     * has, a single voter may require to split their vote into multiple transactions. For precision higher than
     * ~30 decimals, large token holders may require an exponentially large number of transactions to cast their vote.
     *
     * See `_countVoteNominal` and `_countVoteFractional` for more details.
     */
    function _countVote(
        uint256 proposalId,
        address account,
        uint8 support,
        uint256 totalWeight,
        bytes memory params
    ) internal virtual override returns (uint256) {
        // Compute number of remaining votes. Returns 0 on overflow.
        (, uint256 remainingWeight) = totalWeight.trySub(usedVotes(proposalId, account));
        if (remainingWeight == 0) {
            revert GovernorAlreadyCastVote(account);
        }

        // For clarity of event indexing, fractional voting must be clearly advertised in the "support" field.
        //
        // Supported `support` value must be:
        // - "Full" voting: `support = 0` (Against), `1` (For) or `2` (Abstain), with empty params.
        // - "Fractional" voting: `support = 255`, with 48 bytes params.
        if (support <= uint8(GovernorCountingSimple.VoteType.Abstain)) {
            if (params.length != 0) revert GovernorInvalidVoteParams();
            return _countVoteNominal(proposalId, account, support, remainingWeight);
        } else if (support == VOTE_TYPE_FRACTIONAL) {
            return _countVoteFractional(proposalId, account, params, remainingWeight);
        } else {
            revert GovernorInvalidVoteType();
        }
    }

    /**
     * @dev Record votes with full weight cast for `support`.
     *
     * Because this function votes with the delegate's remaining weight, it can only be called once per proposal and
     * thus does not require any replay protection.
     */
    function _countVoteNominal(
        uint256 proposalId,
        address account,
        uint8 support,
        uint256 weight
    ) private returns (uint256) {
        ProposalVote storage details = _proposalVotes[proposalId];
        details.usedVotes[account] += weight;

        if (support == uint8(GovernorCountingSimple.VoteType.Against)) {
            details.againstVotes += weight;
        } else if (support == uint8(GovernorCountingSimple.VoteType.For)) {
            details.forVotes += weight;
        } else if (support == uint8(GovernorCountingSimple.VoteType.Abstain)) {
            details.abstainVotes += weight;
        }

        return weight;
    }

    /**
     * @dev Count votes with fractional weight.
     *
     * The `params` argument is expected to be three packed `uint128`:
     * `abi.encodePacked(uint128(againstVotes), uint128(forVotes), uint128(abstainVotes))`
     *
     * This function can be called multiple times for the same account and proposal (i.e. partial/rolling votes are
     * allowed). For example, an account with total weight of 10 could call this function three times with the
     * following vote data:
     *
     *   * Against: 1, For: 0, Abstain: 2
     *   * Against: 3, For: 1, Abstain: 0
     *   * Against: 1, For: 1, Abstain: 1
     *
     * Casting votes like this will make the calling account to cast a total of 5 `Against` votes, 2 `For` votes
     * and 3 `Abstain` votes. Though partial, votes are still final once cast and cannot be changed or overridden.
     * Subsequent partial votes simply increment existing totals.
     */
    function _countVoteFractional(
        uint256 proposalId,
        address account,
        bytes memory params,
        uint256 weight
    ) private returns (uint256) {
        (uint128 againstVotes, uint128 forVotes, uint128 abstainVotes) = _unpackParams(params);

        uint256 usedWeight = againstVotes + forVotes + abstainVotes;
        if (usedWeight > weight) {
            revert GovernorExceedRemainingWeight(account, usedWeight, weight);
        }

        ProposalVote storage details = _proposalVotes[proposalId];
        if (againstVotes > 0) {
            details.againstVotes += againstVotes;
        }
        if (forVotes > 0) {
            details.forVotes += forVotes;
        }
        if (abstainVotes > 0) {
            details.abstainVotes += abstainVotes;
        }
        details.usedVotes[account] += usedWeight;

        return usedWeight;
    }

    function _unpackParams(
        bytes memory data
    ) private pure returns (uint128 againstVotes, uint128 forVotes, uint128 abstainVotes) {
        if (data.length != 0x30) {
            revert GovernorInvalidVoteParams();
        }

        assembly ("memory-safe") {
            let ptr := add(data, 0x20)
            againstVotes := shr(128, mload(ptr))
            forVotes := shr(128, mload(add(ptr, 0x10)))
            abstainVotes := shr(128, mload(add(ptr, 0x20)))
        }
    }
}