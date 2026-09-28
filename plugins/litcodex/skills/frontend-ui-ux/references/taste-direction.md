# Taste direction

Use this reference when a product needs a bounded visual direction. The `taste` object is optional and additive in `litfamily.design-contract/v1beta2`. It does not replace the contract inventory, acceptance criteria, accessibility requirements, or evidence rules.

## The three dials

Record each dial as an integer from 1 through 10. Use the values as a relative target for the product. Do not treat them as a universal quality score.

| Dial | Low values | High values |
| --- | --- | --- |
| `variance` | Repeated forms, restrained contrast, and a predictable visual rhythm | More variation in scale, shape, contrast, or composition while keeping the task path clear |
| `motion` | Little or no movement beyond necessary state feedback | More expressive transitions and choreography when they improve orientation or feedback |
| `density` | More whitespace, fewer simultaneous choices, and slower information scanning | More information in the same area with tighter grouping and stronger hierarchy |

State the reason for each value in the surrounding design direction. A high value does not permit visual noise. A low value does not permit weak hierarchy.

## Accessibility and reduced motion

Accessibility outranks taste. Keep readable contrast, keyboard access, target size, focus visibility, screen-reader structure, zoom support, and forced-colors behavior in the base contract. Treat `motion` as a preference for the default experience, not permission to ignore `prefers-reduced-motion`.

Define a reduced-motion result for every animated behavior. Remove or shorten non-essential movement. Preserve the state change, focus result, and task feedback without relying on motion. Record a conflict when a taste target would harm accessibility. Resolve the conflict in favor of the accessible behavior.

## Evidence use

Taste records design intent. It does not prove a rendered result. Use the design contract hash, declared inventory, binary acceptance criteria, and the visual-qa evidence manifest for verification. Compare the rendered result with the selected values during review. Record the observed difference as evidence. Do not turn a subjective preference into a PASS claim.

Omit `taste` when the team has no stable direction to record. Adding the object later is safe because v1beta2 defines it as optional and additive. The validator rejects unknown taste keys, non-integer values, and values outside 1 through 10.
