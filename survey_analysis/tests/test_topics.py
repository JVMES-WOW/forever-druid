import numpy as np

from forever_survey.text import topic_outputs


DOCS = (["energy pooling and meaningful resource decisions"] * 8 +
        ["bear weaving and shapeshifting identity"] * 8 +
        ["bleed gameplay rake rip active"] * 8 +
        ["aoe swipe multi target tools"] * 8)


def test_topic_output_shape_and_determinism():
    labels = ["Energy", "Weaving", "Bleeds", "AoE"]
    out1 = topic_outputs(DOCS, 4, labels)
    out2 = topic_outputs(DOCS, 4, labels)
    assert out1[3].shape == (32, 7)
    assert out1[2].primary_count.sum() == 32
    np.testing.assert_allclose(out1[3].filter(like="weight_").to_numpy(),
                               out2[3].filter(like="weight_").to_numpy())
