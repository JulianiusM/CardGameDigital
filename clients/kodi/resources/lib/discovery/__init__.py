"""Local DNS-SD discovery and server registry."""

from .address_policy import AddressPolicyError, normalize_origin, validate_transport

__all__ = ["AddressPolicyError", "normalize_origin", "validate_transport"]

