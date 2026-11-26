/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/abyss_bridge.json`.
 */
export type AbyssBridge = {
  "address": "Gw5k91LH43GRxwS335Bnw8o3BNWF16Lkm57LwHypF9XX",
  "metadata": {
    "name": "abyssBridge",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Abyss Bridge — MagicBlock ER/VRF/PER glass-bridge game (see SPEC.md)"
  },
  "instructions": [
    {
      "name": "cashOut",
      "discriminator": [
        1,
        110,
        57,
        58,
        159,
        157,
        243,
        192
      ],
      "accounts": [
        {
          "name": "player",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "owner"
        },
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "economy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  99,
                  111,
                  110,
                  111,
                  109,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "bridgePub",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "claimRushReward",
      "discriminator": [
        233,
        203,
        66,
        124,
        154,
        126,
        61,
        231
      ],
      "accounts": [
        {
          "name": "player",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "owner"
        },
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "economy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  99,
                  111,
                  110,
                  111,
                  109,
                  121
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "commitAndUndelegatePlayer",
      "discriminator": [
        107,
        76,
        176,
        95,
        152,
        184,
        182,
        76
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "owner",
          "docs": [
            "PlayerState.owner inside the handler."
          ]
        },
        {
          "name": "player",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "magicContext",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "consumeVrfRandomness",
      "discriminator": [
        51,
        186,
        112,
        30,
        158,
        165,
        198,
        207
      ],
      "accounts": [
        {
          "name": "vrfProgramIdentity",
          "docs": [
            "Scoped VRF identity PDA, bound to this program. Its presence as a signer proves",
            "the callback was issued by the VRF program for this program."
          ],
          "signer": true
        },
        {
          "name": "bridgePub",
          "writable": true
        },
        {
          "name": "bridgeSec",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "randomness",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "createBridgeSecPermission",
      "discriminator": [
        185,
        122,
        54,
        66,
        18,
        118,
        240,
        146
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "vaultCfg"
          ]
        },
        {
          "name": "vaultCfg",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  99,
                  102,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "bridgeSec"
        },
        {
          "name": "permission",
          "docs": [
            "Permission Program); the address is validated in the handler",
            "and the account is created by the CPI."
          ],
          "writable": true
        },
        {
          "name": "permissionProgram",
          "address": "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "diff",
          "type": "u8"
        }
      ]
    },
    {
      "name": "delegateBridgePub",
      "discriminator": [
        234,
        221,
        94,
        98,
        254,
        126,
        191,
        83
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "bufferBridgePub",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "bridgePub"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                236,
                186,
                8,
                7,
                236,
                58,
                173,
                28,
                81,
                28,
                48,
                137,
                110,
                1,
                8,
                90,
                66,
                154,
                91,
                207,
                74,
                111,
                234,
                38,
                228,
                35,
                50,
                199,
                20,
                52,
                9,
                42
              ]
            }
          }
        },
        {
          "name": "delegationRecordBridgePub",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "bridgePub"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataBridgePub",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "bridgePub"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "bridgePub",
          "writable": true
        },
        {
          "name": "ownerProgram",
          "address": "Gw5k91LH43GRxwS335Bnw8o3BNWF16Lkm57LwHypF9XX"
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "diff",
          "type": "u8"
        },
        {
          "name": "validator",
          "type": {
            "option": "pubkey"
          }
        }
      ]
    },
    {
      "name": "delegateBridgeSec",
      "discriminator": [
        76,
        98,
        255,
        200,
        136,
        129,
        235,
        218
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "bufferBridgeSec",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "bridgeSec"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                236,
                186,
                8,
                7,
                236,
                58,
                173,
                28,
                81,
                28,
                48,
                137,
                110,
                1,
                8,
                90,
                66,
                154,
                91,
                207,
                74,
                111,
                234,
                38,
                228,
                35,
                50,
                199,
                20,
                52,
                9,
                42
              ]
            }
          }
        },
        {
          "name": "delegationRecordBridgeSec",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "bridgeSec"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataBridgeSec",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "bridgeSec"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "bridgeSec",
          "writable": true
        },
        {
          "name": "ownerProgram",
          "address": "Gw5k91LH43GRxwS335Bnw8o3BNWF16Lkm57LwHypF9XX"
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "diff",
          "type": "u8"
        },
        {
          "name": "validator",
          "type": {
            "option": "pubkey"
          }
        }
      ]
    },
    {
      "name": "delegateBridgeSecPermission",
      "discriminator": [
        32,
        189,
        48,
        205,
        241,
        81,
        130,
        248
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "vaultCfg"
          ]
        },
        {
          "name": "vaultCfg",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  99,
                  102,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "bridgeSec"
        },
        {
          "name": "permission",
          "writable": true
        },
        {
          "name": "bufferPermission",
          "docs": [
            "Permission Program, the permission account's owner program)."
          ],
          "writable": true
        },
        {
          "name": "delegationRecordPermission",
          "docs": [
            "the Delegation Program)."
          ],
          "writable": true
        },
        {
          "name": "delegationMetadataPermission",
          "docs": [
            "permission] under the Delegation Program)."
          ],
          "writable": true
        },
        {
          "name": "permissionProgram",
          "address": "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1"
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "validator",
          "docs": [
            "every other account is delegated to (same-validator rule)."
          ],
          "optional": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "diff",
          "type": "u8"
        }
      ]
    },
    {
      "name": "delegateEconomy",
      "discriminator": [
        174,
        200,
        202,
        180,
        63,
        75,
        92,
        43
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "bufferEconomy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "economy"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                236,
                186,
                8,
                7,
                236,
                58,
                173,
                28,
                81,
                28,
                48,
                137,
                110,
                1,
                8,
                90,
                66,
                154,
                91,
                207,
                74,
                111,
                234,
                38,
                228,
                35,
                50,
                199,
                20,
                52,
                9,
                42
              ]
            }
          }
        },
        {
          "name": "delegationRecordEconomy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "economy"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataEconomy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "economy"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "economy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  99,
                  111,
                  110,
                  111,
                  109,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "ownerProgram",
          "address": "Gw5k91LH43GRxwS335Bnw8o3BNWF16Lkm57LwHypF9XX"
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "validator",
          "type": {
            "option": "pubkey"
          }
        }
      ]
    },
    {
      "name": "delegatePlayer",
      "discriminator": [
        235,
        159,
        245,
        102,
        161,
        199,
        254,
        89
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "bufferPlayer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "player"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                236,
                186,
                8,
                7,
                236,
                58,
                173,
                28,
                81,
                28,
                48,
                137,
                110,
                1,
                8,
                90,
                66,
                154,
                91,
                207,
                74,
                111,
                234,
                38,
                228,
                35,
                50,
                199,
                20,
                52,
                9,
                42
              ]
            }
          }
        },
        {
          "name": "delegationRecordPlayer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "player"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataPlayer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "player"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "player",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "payer"
              }
            ]
          }
        },
        {
          "name": "ownerProgram",
          "address": "Gw5k91LH43GRxwS335Bnw8o3BNWF16Lkm57LwHypF9XX"
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "validator",
          "type": {
            "option": "pubkey"
          }
        }
      ]
    },
    {
      "name": "deposit",
      "discriminator": [
        242,
        35,
        198,
        137,
        82,
        225,
        242,
        182
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "player",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "vaultCfg",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  99,
                  102,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "userAta",
          "writable": true
        },
        {
          "name": "vaultAta",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "sessionKey",
          "type": "pubkey"
        },
        {
          "name": "sessionExpiry",
          "type": "i64"
        }
      ]
    },
    {
      "name": "enterBridge",
      "discriminator": [
        242,
        223,
        63,
        202,
        11,
        5,
        168,
        31
      ],
      "accounts": [
        {
          "name": "player",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "owner"
        },
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "economy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  99,
                  111,
                  110,
                  111,
                  109,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "bridgePub",
          "writable": true
        },
        {
          "name": "bridgeSec"
        }
      ],
      "args": [
        {
          "name": "diff",
          "type": "u8"
        }
      ]
    },
    {
      "name": "finalizeRush",
      "discriminator": [
        237,
        183,
        213,
        79,
        4,
        52,
        234,
        31
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "economy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  99,
                  111,
                  110,
                  111,
                  109,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "rushBridgePub"
        }
      ],
      "args": []
    },
    {
      "name": "initBridges",
      "discriminator": [
        217,
        238,
        34,
        69,
        243,
        28,
        15,
        111
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "vaultCfg",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  99,
                  102,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "bridgePub0",
          "writable": true
        },
        {
          "name": "bridgeSec0",
          "writable": true
        },
        {
          "name": "bridgePub1",
          "writable": true
        },
        {
          "name": "bridgeSec1",
          "writable": true
        },
        {
          "name": "bridgePub2",
          "writable": true
        },
        {
          "name": "bridgeSec2",
          "writable": true
        },
        {
          "name": "bridgePub3",
          "writable": true
        },
        {
          "name": "bridgeSec3",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initializeProtocol",
      "discriminator": [
        188,
        233,
        252,
        106,
        134,
        146,
        202,
        91
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "vaultCfg",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  99,
                  102,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "economy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  99,
                  111,
                  110,
                  111,
                  109,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "vaultAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vaultCfg"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdcMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "authorityAta",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "eventTarget",
          "type": "u64"
        },
        {
          "name": "rushDurationSecs",
          "type": "i64"
        },
        {
          "name": "initialHouseReserve",
          "type": "u64"
        }
      ]
    },
    {
      "name": "processUndelegation",
      "discriminator": [
        196,
        28,
        41,
        206,
        48,
        37,
        51,
        167
      ],
      "accounts": [
        {
          "name": "baseAccount",
          "writable": true
        },
        {
          "name": "buffer",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  110,
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  101,
                  45,
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "baseAccount"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                181,
                183,
                0,
                225,
                242,
                87,
                58,
                192,
                204,
                6,
                34,
                1,
                52,
                74,
                207,
                151,
                184,
                53,
                6,
                235,
                140,
                229,
                25,
                152,
                204,
                98,
                126,
                24,
                147,
                128,
                167,
                62
              ]
            }
          }
        },
        {
          "name": "payer",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "accountSeeds",
          "type": {
            "vec": "bytes"
          }
        }
      ]
    },
    {
      "name": "requestBridgeVrf",
      "discriminator": [
        5,
        195,
        47,
        70,
        202,
        107,
        47,
        234
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "bridgePub"
        },
        {
          "name": "bridgeSec"
        },
        {
          "name": "oracleQueue",
          "docs": [
            "queues inside the handler."
          ],
          "writable": true
        },
        {
          "name": "programIdentity",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  100,
                  101,
                  110,
                  116,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vrfProgram",
          "address": "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "diff",
          "type": "u8"
        }
      ]
    },
    {
      "name": "seedHouse",
      "discriminator": [
        229,
        47,
        19,
        196,
        159,
        230,
        135,
        101
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "vaultCfg",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  99,
                  102,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "economy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  99,
                  111,
                  110,
                  111,
                  109,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "authorityAta",
          "writable": true
        },
        {
          "name": "vaultAta",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "stepTile",
      "discriminator": [
        50,
        40,
        119,
        16,
        126,
        191,
        126,
        125
      ],
      "accounts": [
        {
          "name": "player",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "owner"
        },
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "economy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  99,
                  111,
                  110,
                  111,
                  109,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "bridgePub",
          "writable": true
        },
        {
          "name": "bridgeSec",
          "writable": true
        },
        {
          "name": "rushBridgeSec",
          "docs": [
            "The Rush bridge secret, so a fall can flag its VRF reseed when",
            "the fall triggers Resurrection Rush. Optional: when the player",
            "is ON the Rush bridge (diff == 3) this is the same account as",
            "bridge_sec, and Anchor rejects duplicate mutable accounts —",
            "clients pass None there (the trigger only fires on falls in",
            "modes 0..2 anyway)."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "rushBridgePub",
          "docs": [
            "Public mirror of the Rush bridge, kept in sync with",
            "rush_bridge_sec (Batch 2 patch). Optional for the same",
            "duplicate-account reason as rush_bridge_sec."
          ],
          "writable": true,
          "optional": true
        }
      ],
      "args": [
        {
          "name": "col",
          "type": "u8"
        }
      ]
    },
    {
      "name": "withdrawL1",
      "discriminator": [
        212,
        140,
        56,
        231,
        6,
        1,
        56,
        18
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "player",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "vaultCfg",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  99,
                  102,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "vaultAta",
          "writable": true
        },
        {
          "name": "userAta",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "bridgePublic",
      "discriminator": [
        49,
        226,
        179,
        16,
        83,
        224,
        142,
        33
      ]
    },
    {
      "name": "bridgeSecret",
      "discriminator": [
        165,
        237,
        123,
        209,
        41,
        114,
        117,
        208
      ]
    },
    {
      "name": "globalEconomy",
      "discriminator": [
        236,
        112,
        160,
        228,
        16,
        26,
        21,
        3
      ]
    },
    {
      "name": "playerState",
      "discriminator": [
        56,
        3,
        60,
        86,
        174,
        16,
        244,
        195
      ]
    },
    {
      "name": "vaultConfig",
      "discriminator": [
        99,
        86,
        43,
        216,
        184,
        102,
        119,
        77
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "mathOverflow",
      "msg": "Math overflow"
    },
    {
      "code": 6001,
      "name": "unauthorized",
      "msg": "Signer is neither the owner nor a live session key"
    },
    {
      "code": 6002,
      "name": "sessionExpired",
      "msg": "Session key has expired"
    },
    {
      "code": 6003,
      "name": "invalidDifficulty",
      "msg": "Invalid difficulty"
    },
    {
      "code": 6004,
      "name": "invalidColumn",
      "msg": "Invalid column for this bridge"
    },
    {
      "code": 6005,
      "name": "alreadyOnBridge",
      "msg": "Player is already on a bridge"
    },
    {
      "code": 6006,
      "name": "notOnBridge",
      "msg": "Player is not on a bridge"
    },
    {
      "code": 6007,
      "name": "bridgeSeedPending",
      "msg": "Bridge layout is not seeded yet (VRF pending)"
    },
    {
      "code": 6008,
      "name": "bridgeRoundReset",
      "msg": "Bridge round was reset by another finisher; cash out to exit"
    },
    {
      "code": 6009,
      "name": "insufficientBalance",
      "msg": "Insufficient PlayerState balance"
    },
    {
      "code": 6010,
      "name": "insufficientPasses",
      "msg": "No Fallen Pass available"
    },
    {
      "code": 6011,
      "name": "noBlindSteps",
      "msg": "Cash out requires at least 1 blind step"
    },
    {
      "code": 6012,
      "name": "bridgeFull",
      "msg": "Bridge runner slots are full"
    },
    {
      "code": 6013,
      "name": "rushNotActive",
      "msg": "Resurrection Rush is not active"
    },
    {
      "code": 6014,
      "name": "rushStillActive",
      "msg": "Resurrection Rush is still running"
    },
    {
      "code": 6015,
      "name": "notRushWinner",
      "msg": "Player did not win the settled Rush"
    },
    {
      "code": 6016,
      "name": "alreadyClaimed",
      "msg": "Rush reward already claimed"
    },
    {
      "code": 6017,
      "name": "invalidOracleQueue",
      "msg": "Oracle queue is not a recognised MagicBlock VRF queue"
    },
    {
      "code": 6018,
      "name": "playerOnBridge",
      "msg": "Player is on a bridge; cash out or finish first"
    },
    {
      "code": 6019,
      "name": "devSeedDisabled",
      "msg": "Dev seed helper is disabled in this build"
    },
    {
      "code": 6020,
      "name": "invalidPermissionAccount",
      "msg": "Permission account does not match the expected Permission PDA"
    }
  ],
  "types": [
    {
      "name": "bridgePublic",
      "docs": [
        "Public board state (frontend-subscribable). Seeds:",
        "`[\"bridge_pub\", &[diff]]`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "diff",
            "type": "u8"
          },
          {
            "name": "cols",
            "type": "u8"
          },
          {
            "name": "rows",
            "type": "u8"
          },
          {
            "name": "roundId",
            "type": "u32"
          },
          {
            "name": "vrfPending",
            "docs": [
              "Mirror of BridgeSecret.vrf_pending (Batch 2 micro-patch): the",
              "frontend must NEVER read BridgeSecret (PER will lock it in",
              "Batch 3), so the shuffle state is published here. BridgeSecret",
              "remains the contract-side source of truth; every write path",
              "updates both."
            ],
            "type": "bool"
          },
          {
            "name": "revealedSafeCol",
            "docs": [
              "Per-row revealed safe column; 255 = hidden."
            ],
            "type": {
              "array": [
                "u8",
                8
              ]
            }
          },
          {
            "name": "brokenMask",
            "docs": [
              "Per-row bitmask of broken (trap) columns."
            ],
            "type": {
              "array": [
                "u8",
                8
              ]
            }
          },
          {
            "name": "activeRunners",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "runnerSlot"
                  }
                },
                8
              ]
            }
          }
        ]
      }
    },
    {
      "name": "bridgeSecret",
      "docs": [
        "Hidden safe-tile answers. PER/TEE-locked in Batch 3. Seeds:",
        "`[\"bridge_sec\", &[diff]]`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "diff",
            "type": "u8"
          },
          {
            "name": "roundId",
            "type": "u32"
          },
          {
            "name": "safeCol",
            "type": {
              "array": [
                "u8",
                8
              ]
            }
          },
          {
            "name": "vrfPending",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "globalEconomy",
      "docs": [
        "Shared economy ledger, delegated to the ER once and resident there.",
        "Seeds: `[\"economy\"]`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "houseReserveBal",
            "type": "u64"
          },
          {
            "name": "eventVaultBal",
            "type": "u64"
          },
          {
            "name": "treasuryBal",
            "type": "u64"
          },
          {
            "name": "eventTarget",
            "type": "u64"
          },
          {
            "name": "rushDurationSecs",
            "type": "i64"
          },
          {
            "name": "rushActive",
            "type": "bool"
          },
          {
            "name": "rushRoundId",
            "type": "u32"
          },
          {
            "name": "rushEndTs",
            "type": "i64"
          },
          {
            "name": "rushPrizePool",
            "type": "u64"
          },
          {
            "name": "rushHighestRow",
            "type": "u8"
          },
          {
            "name": "rushHighestCount",
            "type": "u16"
          },
          {
            "name": "rushFinishersCount",
            "type": "u16"
          },
          {
            "name": "settledRushId",
            "type": "u32"
          },
          {
            "name": "settledWinningRow",
            "type": "u8"
          },
          {
            "name": "settledPayoutPerWinner",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "playerState",
      "docs": [
        "Per-player state, the only account that travels L1 <-> ER.",
        "Seeds: `[\"player\", owner]`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "balance",
            "docs": [
              "Internal Mock USDC ledger balance (backed by VaultConfig.vault_ata)."
            ],
            "type": "u64"
          },
          {
            "name": "fallenPasses",
            "type": "u16"
          },
          {
            "name": "isOnBridge",
            "type": "bool"
          },
          {
            "name": "activeDiff",
            "type": "u8"
          },
          {
            "name": "entryRoundId",
            "type": "u32"
          },
          {
            "name": "currentRow",
            "type": "u8"
          },
          {
            "name": "blindSteps",
            "type": "u8"
          },
          {
            "name": "lastRushId",
            "docs": [
              "Last Rush the player entered."
            ],
            "type": "u32"
          },
          {
            "name": "lastRushBestRow",
            "docs": [
              "Best rows-completed in that Rush (double-count watermark)."
            ],
            "type": "u8"
          },
          {
            "name": "rushClaimedId",
            "docs": [
              "Rush id whose reward this player already claimed."
            ],
            "type": "u32"
          },
          {
            "name": "sessionKey",
            "docs": [
              "Native session key (Batch 1 rule 1): an ephemeral browser",
              "keypair registered by the owner at deposit time."
            ],
            "type": "pubkey"
          },
          {
            "name": "sessionExpiry",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "runnerSlot",
      "docs": [
        "Lightweight visual snapshot of one runner on a bridge."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pubkey",
            "type": "pubkey"
          },
          {
            "name": "row",
            "type": "u8"
          },
          {
            "name": "col",
            "type": "u8"
          },
          {
            "name": "blindSteps",
            "type": "u8"
          },
          {
            "name": "active",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "vaultConfig",
      "docs": [
        "L1 protocol configuration. Seeds: `[\"vault_cfg\"]`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "usdcMint",
            "type": "pubkey"
          },
          {
            "name": "vaultAta",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
