// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "../../governance/extensions/GovernorTimelockControl.sol";
import "../../governance/extensions/GovernorSettings.sol";
import "../../governance/extensions/GovernorCountingSimple.sol";
import "../../governance/extensions/GovernorVotesQuorumFraction.sol";

abstract contract GovernorTimelockControlMock is
    GovernorSettings,
    GovernorTimelockControl,
    GovernorVotesQuorumFraction,
    GovernorCountingSimple
{
    function supportsInterface(
        bytes4 interfaceId
    ) public view override(Governor, GovernorTimelockControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function quorum(
        uint256 blockNumber
    ) public view override(IGovernor, GovernorVotesQuorumFraction) returns (uint256) {
        return super.quorum(blockNumber);
    }

    function state(uint256 proposalId) public view override(Governor, GovernorTimelockControl) returns (ProposalState) {
        return super.state(proposalId);
    }

    function proposalThreshold() public view override(Governor, GovernorSettings) returns (uint256) {
        return super.proposalThreshold();
    }

    function _queueCalls(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) returns (bool, uint256) {
        return super._queueCalls(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _executeCalls(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) {
        super._executeCalls(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _cancel(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) {
        return super._cancel(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _executor() internal view override(Governor, GovernorTimelockControl) returns (address) {
        return super._executor();
    }

    function nonGovernanceFunction() external {}
}
