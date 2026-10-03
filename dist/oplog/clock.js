// Lamport clock rules (§4.2).
const max_of = (initial, values) => {
    let max = initial;
    for (const value of values)
        if (value > max)
            max = value;
    return max;
};
// Append rule over every current head, whoever signed it. local_time carries
// the merge rule's result into the next append.
export const next_clock_time = ({ local_time, head_times }) => max_of(local_time, head_times) + 1;
export const merge_clock_time = ({ local_time, remote_times }) => max_of(local_time, remote_times);
