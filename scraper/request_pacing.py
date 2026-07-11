import random


def poisson_sleep(lambda_mean=1.5):
    """
    Calculate inter-request sleep duration using Poisson process model.

    Uses exponential distribution to model inter-arrival times of a Poisson
    process, creating natural-looking request timing variance that mimics
    organic browsing patterns rather than mechanical uniform intervals.

    Args:
        lambda_mean: Target average sleep time in seconds (default: 1.5)

    Returns:
        Sleep duration in seconds
    """
    return random.expovariate(1.0 / lambda_mean)
