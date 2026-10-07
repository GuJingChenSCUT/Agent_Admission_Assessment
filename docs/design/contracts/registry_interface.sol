// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Design interface only. No implementation, deployment, or audit is supplied.
/// @dev Domain: AgentAdmissionEvidence, version 1, chain 677, deployed registry.
/// Trusted validator is immutable in the eventual P0 implementation.
interface IAgentAdmissionEvidenceRegistry {
    // 0 SUCCEEDED, 1 FAILED, 2 QUARANTINED, 3 CANCELLED.
    struct EvidenceClaim {
        bytes32 reportHash;
        bytes32 taskSpecHash;
        bytes32 policyHash;
        bytes32 subjectHash;
        uint256 sourceChainId;
        uint8 resultCode;
        bytes32 evidenceURIHash;
        uint64 observedAt;
        uint64 expiresAt;
        uint256 nonce;
    }

    event EvidenceSubmitted(
        bytes32 indexed reportHash,
        address indexed validator,
        uint256 indexed sourceChainId,
        bytes32 taskSpecHash,
        bytes32 policyHash,
        bytes32 subjectHash,
        uint8 resultCode,
        string evidenceURI,
        uint64 observedAt,
        uint64 expiresAt,
        uint256 nonce
    );
    event EvidenceRevoked(bytes32 indexed reportHash, address indexed validator, bytes32 reasonHash);

    function trustedValidator() external view returns (address);
    function submitEvidence(EvidenceClaim calldata claim, string calldata evidenceURI, bytes calldata validatorSignature) external;
    function revokeEvidence(bytes32 reportHash, bytes32 reasonHash) external;
    function isRegistered(bytes32 reportHash) external view returns (bool);
    function isRevoked(bytes32 reportHash) external view returns (bool);
}

// Required implementation checks:
// - recover configured validator with vetted EIP-712/ECDSA implementation;
// - exact domain chain + address, nonce replay protection, unique reportHash;
// - sourceChainId == 1, resultCode <= 3, observedAt <= expiresAt;
// - keccak256(bytes(evidenceURI)) == claim.evidenceURIHash; limit URI byte length;
// - expiry and clock tolerance policy explicitly configured;
// - only original trusted validator may revoke an existing report, once;
// - append-only records, no arbitrary external call, no funds, no upgrade route;
// - indexer checks successful receipt AND matching contract/event/canonical block;
// - signature, validity, revocation and content integrity remain separate checks.
