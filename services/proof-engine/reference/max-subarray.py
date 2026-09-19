"""Reference solution. Correct on the empty list and on all-negative input -
the two places student Kadane implementations reliably break."""


def max_subarray(nums):
    if not nums:
        raise ValueError("empty input")
    best = cur = nums[0]
    for n in nums[1:]:
        cur = max(n, cur + n)
        best = max(best, cur)
    return best
