// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title SignalArc Gate EndpointRegistry
/// @notice Base Mainnet configuration/authorization registry. Never verifies or settles a payment.
/// @dev Immutable, permissionless and non-custodial. No external calls, token handling, admin or proxy.
contract EndpointRegistry {
    uint256 public constant CHAIN_ID = 8453;
    uint96 public constant MAX_PRICE_ATOMIC = 999_999_999_999;
    bytes32 public constant RESOURCE_ID_DOMAIN = keccak256("SignalArcGate.Resource.v1");

    /// @dev Four slots per mapping entry: owner/version/enabled; payout/price; hash; pendingOwner.
    ///      An entry exists iff owner != address(0). Disable never deletes or releases its ID.
    struct Resource {
        address owner;
        uint64 version;
        bool enabled;
        address payout;
        uint96 priceAtomic;
        bytes32 configHash;
        address pendingOwner;
    }

    mapping(bytes32 resourceId => Resource) private resources;

    error UnsupportedChain(uint256 chainId);
    error ZeroAddress();
    error InvalidResourceId();
    error InvalidPrice(uint96 priceAtomic);
    error InvalidConfigHash();
    error AlreadyRegistered(bytes32 resourceId);
    error ResourceNotFound(bytes32 resourceId);
    error Unauthorized();
    error VersionMismatch(uint64 expected, uint64 actual);
    error NoConfigurationChange();
    error AlreadyDisabled();
    error InvalidNewOwner();
    error NoPendingTransfer();

    event ResourceRegistered(
        bytes32 indexed resourceId,
        address indexed owner,
        bytes16 indexed d1ResourceId,
        address payout,
        uint96 priceAtomic,
        bytes32 configHash,
        bool enabled,
        uint64 version
    );
    event ConfigurationUpdated(
        bytes32 indexed resourceId,
        address indexed owner,
        address payout,
        uint96 priceAtomic,
        bytes32 configHash,
        bool enabled,
        uint64 version
    );
    event ResourceDisabled(bytes32 indexed resourceId, address indexed owner, uint64 version);
    event OwnershipTransferStarted(
        bytes32 indexed resourceId, address indexed owner, address indexed pendingOwner, uint64 version
    );
    event OwnershipTransferCancelled(
        bytes32 indexed resourceId, address indexed owner, address indexed pendingOwner, uint64 version
    );
    event OwnershipTransferred(
        bytes32 indexed resourceId, address indexed previousOwner, address indexed newOwner, uint64 version
    );

    constructor() {
        if (block.chainid != CHAIN_ID) revert UnsupportedChain(block.chainid);
    }

    /// @notice D1 UUID bytes plus ORIGINAL registering wallet define a stable namespace.
    /// @dev Use abi.encode, not encodePacked. Transfer never changes this ID.
    function deriveResourceId(address originalOwner, bytes16 d1ResourceId) public pure returns (bytes32) {
        if (originalOwner == address(0)) revert ZeroAddress();
        if (d1ResourceId == bytes16(0)) revert InvalidResourceId();
        return keccak256(abi.encode(RESOURCE_ID_DOMAIN, CHAIN_ID, originalOwner, d1ResourceId));
    }

    /// @notice Only owner itself may register. No relayer or administrator impersonation.
    /// @dev configHash is an opaque, nonzero commitment; this contract cannot validate its preimage.
    function register(
        bytes16 d1ResourceId,
        address owner,
        address payout,
        uint96 priceAtomic,
        bytes32 configHash,
        bool enabled
    ) external returns (bytes32 resourceId) {
        resourceId = deriveResourceId(owner, d1ResourceId);
        if (msg.sender != owner) revert Unauthorized();
        if (resources[resourceId].owner != address(0)) revert AlreadyRegistered(resourceId);
        _validate(payout, priceAtomic, configHash);
        resources[resourceId] = Resource({
            owner: owner,
            version: 1,
            enabled: enabled,
            payout: payout,
            priceAtomic: priceAtomic,
            configHash: configHash,
            pendingOwner: address(0)
        });
        emit ResourceRegistered(resourceId, owner, d1ResourceId, payout, priceAtomic, configHash, enabled, 1);
    }

    /// @notice Update configuration, including explicit re-enabling after disable.
    /// @dev Every mutation uses optimistic concurrency. Ownership/payout are separate concepts.
    function updateConfiguration(
        bytes32 resourceId,
        uint64 expectedVersion,
        address payout,
        uint96 priceAtomic,
        bytes32 configHash,
        bool enabled
    ) external {
        Resource storage resource = _owned(resourceId, expectedVersion);
        _validate(payout, priceAtomic, configHash);
        if (
            resource.payout == payout && resource.priceAtomic == priceAtomic
                && resource.configHash == configHash && resource.enabled == enabled
        ) revert NoConfigurationChange();
        resource.payout = payout;
        resource.priceAtomic = priceAtomic;
        resource.configHash = configHash;
        resource.enabled = enabled;
        ++resource.version;
        emit ConfigurationUpdated(
            resourceId, msg.sender, payout, priceAtomic, configHash, enabled, resource.version
        );
    }

    /// @notice Soft-disable without deleting configuration or releasing the identifier.
    function disable(bytes32 resourceId, uint64 expectedVersion) external {
        Resource storage resource = _owned(resourceId, expectedVersion);
        if (!resource.enabled) revert AlreadyDisabled();
        resource.enabled = false;
        ++resource.version;
        emit ResourceDisabled(resourceId, msg.sender, resource.version);
    }

    /// @notice Nominate or replace a pending owner. Ownership remains unchanged until acceptance.
    function transferOwnership(bytes32 resourceId, uint64 expectedVersion, address newOwner) external {
        Resource storage resource = _owned(resourceId, expectedVersion);
        if (newOwner == address(0)) revert ZeroAddress();
        if (newOwner == resource.owner || newOwner == resource.pendingOwner) revert InvalidNewOwner();
        resource.pendingOwner = newOwner;
        ++resource.version;
        emit OwnershipTransferStarted(resourceId, msg.sender, newOwner, resource.version);
    }

    function cancelOwnershipTransfer(bytes32 resourceId, uint64 expectedVersion) external {
        Resource storage resource = _owned(resourceId, expectedVersion);
        address pending = resource.pendingOwner;
        if (pending == address(0)) revert NoPendingTransfer();
        resource.pendingOwner = address(0);
        ++resource.version;
        emit OwnershipTransferCancelled(resourceId, msg.sender, pending, resource.version);
    }

    /// @notice Only nominated owner accepts the current version; does not alter payout or enabled state.
    function acceptOwnership(bytes32 resourceId, uint64 expectedVersion) external {
        Resource storage resource = _existing(resourceId);
        if (resource.pendingOwner == address(0) || msg.sender != resource.pendingOwner) {
            revert Unauthorized();
        }
        _checkVersion(resource, expectedVersion);
        address previous = resource.owner;
        resource.owner = msg.sender;
        resource.pendingOwner = address(0);
        ++resource.version;
        emit OwnershipTransferred(resourceId, previous, msg.sender, resource.version);
    }

    /// @notice Missing resources revert rather than returning a misleading all-zero configuration.
    function getResource(bytes32 resourceId) external view returns (Resource memory) {
        return _existing(resourceId);
    }

    function _existing(bytes32 resourceId) private view returns (Resource storage resource) {
        resource = resources[resourceId];
        if (resource.owner == address(0)) revert ResourceNotFound(resourceId);
    }

    function _owned(bytes32 resourceId, uint64 expectedVersion)
        private
        view
        returns (Resource storage resource)
    {
        resource = _existing(resourceId);
        if (msg.sender != resource.owner) revert Unauthorized();
        _checkVersion(resource, expectedVersion);
    }

    function _checkVersion(Resource storage resource, uint64 expectedVersion) private view {
        if (expectedVersion != resource.version) revert VersionMismatch(expectedVersion, resource.version);
    }

    function _validate(address payout, uint96 priceAtomic, bytes32 configHash) private pure {
        if (payout == address(0)) revert ZeroAddress();
        if (priceAtomic == 0 || priceAtomic > MAX_PRICE_ATOMIC) revert InvalidPrice(priceAtomic);
        if (configHash == bytes32(0)) revert InvalidConfigHash();
    }
}
