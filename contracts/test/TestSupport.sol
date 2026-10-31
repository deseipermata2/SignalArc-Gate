// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev Only official Foundry cheatcodes used here. No forge-std or Git submodule dependency.
interface Vm {
    struct Log {
        bytes32[] topics;
        bytes data;
        address emitter;
    }
    function prank(address sender) external;
    function expectRevert(bytes calldata reason) external;
    function expectRevert(bytes4 selector) external;
    function expectEmit(bool topic1, bool topic2, bool topic3, bool data, address emitter) external;
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory);
    function chainId(uint256 newChainId) external;
    function deal(address account, uint256 newBalance) external;
    function store(address target, bytes32 slot, bytes32 value) external;
}

abstract contract TestSupport {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function assertEq(uint256 a, uint256 b) internal pure {
        require(a == b, "uint mismatch");
    }

    function assertEq(address a, address b) internal pure {
        require(a == b, "address mismatch");
    }

    function assertEq(bytes32 a, bytes32 b) internal pure {
        require(a == b, "bytes32 mismatch");
    }

    function assertTrue(bool value) internal pure {
        require(value, "expected true");
    }
}
